/**
 * dsh-session-enhance — Client 半区多仓任务面板纯逻辑(无 React/CSS,可单测)。
 *
 * 收自 ADR-0025 的面板约定(ADR-0028 修订推荐流):
 * - involved 文本框每行一个相对路径(空行/#注释忽略,首见序去重)。
 * - 打开面板自动扫:只展示结构,不预勾选;涉及仓由 task/recommend 按任务描述推荐,用户审核。
 * - tasksRoot 缺省为 parentRoot 下的 `.tasks`。
 * - launch 前校验只做"缺项"提示;issued 门与 ASCII 门由 host 如实报错,面板原文展示。
 * - 偏好(tasksRoot/parentRoot/templateDir/provider/model)存 localStorage,node 下无 window 时退化为空。
 */

export interface TaskBuildInput {
  slug: string
  involved: string[]
  tasksRoot: string
}

/** involved 文本框 → 去重仓列表(空行/#注释忽略,首见序)。 */
export function parseInvolvedLines(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** tasksRoot 缺省:parentRoot 下 `.cross-tasks`(斜杠归一,尾斜杠去掉)。 */
export function suggestTasksRoot(parentRoot: string): string {
  const p = String(parentRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (p === '') return ''
  return `${p}/.cross-tasks`
}

/** slug 格式提示(ASCII 小写短横线/数字):host 的 ASCII 门是底线,这里只拦明显手误。 */
export function validateSlug(slug: string): string | null {
  const s = String(slug ?? '').trim()
  if (s === '') return 'slug 不能为空'
  if (/[^\x00-\x7F]/.test(s)) return 'slug 只能用 ASCII(中文 host 会拒收)'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) return 'slug 用小写英文/数字/短横线(字母或数字开头)'
  if (s.length > 20) return 'slug 不超过 20 个字符(2-3 个英文词,如 cleanup-tmp)'
  return null
}

/** build 缺项校验:返回首个缺项的中文提示,全齐返回 null。 */
export function validateTaskBuild(input: TaskBuildInput): string | null {
  const slugErr = validateSlug(input.slug)
  if (slugErr !== null) return slugErr
  if (!Array.isArray(input.involved) || input.involved.length === 0) return '涉及仓不能为空(等 AI 推荐或手动勾选)'
  if (String(input.tasksRoot ?? '').trim() === '') return '任务根目录不能为空'
  return null
}

/**
 * 中文词 → 英文词的有限映射:描述是中文时靠它给出可读 slug(ADR-0033)。
 * 只列高频动词/对象,不做翻译;命中即用,不命中的中文直接丢。
 */
const SLUG_WORDS: Array<[RegExp, string]> = [
  [/清理|清除|打扫|清空/, 'cleanup'],
  [/删除|移除|去掉/, 'remove'],
  [/修复|修正|修好|修 /, 'fix'],
  [/重构/, 'refactor'],
  [/迁移/, 'migrate'],
  [/升级|更新/, 'upgrade'],
  [/优化/, 'optimize'],
  [/重命名|改名/, 'rename'],
  [/格式化/, 'format'],
  [/新增|添加|补上|加一个/, 'add'],
  [/测试/, 'test'],
  [/文档/, 'docs'],
  [/依赖/, 'deps'],
  [/版本/, 'version'],
  [/配置/, 'config'],
  [/脚本/, 'script'],
  [/面板/, 'panel'],
  [/推荐/, 'recommend'],
  [/会话/, 'session'],
  [/任务/, 'task'],
  [/编译|构建/, 'build'],
  [/部署/, 'deploy'],
  [/回滚/, 'revert'],
  [/校验|验证/, 'verify'],
  [/临时/, 'tmp'],
  [/缓存/, 'cache'],
  [/日志/, 'log'],
]

/** 无意义 ASCII 词(不作为 slug 组成)。 */
const SLUG_NOISE = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'all', 'ai', 'dsh'])

/**
 * 任务英文缩写 slug(ADR-0033):2-3 个英文词、短横线连接、≤20 字符(如 cleanup-tmp)。
 * 优先中文词映射,再取描述里的 ASCII 词;AI 没给 slug 时的兜底。
 * 全部洗空回 'task'(用户手改)。
 */
export function suggestSlugFromText(text: string): string {
  const raw = String(text ?? '')
  const words: string[] = []
  const push = (w: string): void => {
    if (w !== '' && !words.includes(w)) words.push(w)
  }
  for (const [re, en] of SLUG_WORDS) if (re.test(raw)) push(en)
  for (const m of raw.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const w = m[0]
    if (w.length < 2 || SLUG_NOISE.has(w) || words.includes(w)) continue
    push(w)
  }
  const out: string[] = []
  let len = 0
  for (const w of words) {
    const word = w.length > 20 ? w.slice(0, 20).replace(/-+$/, '') : w
    const add = out.length === 0 ? word.length : word.length + 1
    if (len + add > 20) {
      if (out.length === 0) out.push(word)
      break
    }
    out.push(word)
    len += add
    if (out.length === 3) break
  }
  const slug = out.join('-').replace(/^-+|-+$/g, '')
  return slug === '' ? 'task' : slug
}

/**
 * 推荐合并(ADR-0028):recommend 返回的推荐仓与扫描结果求交(保推荐序、去重),
 * 只收 repo/part(unknown/external 不参任务);都不中则空选 + 手勾。
 * 纯函数:面板拿到 recommend 响应后调一次,用户仍可逐项改。
 */
export function applyRecommendDefaults(
  found: ScanRepoLike[],
  recommended: string[],
): { checked: string[] } {
  const known = new Set(
    found
      .filter((r) => r.kind === 'repo' || r.kind === 'part')
      .map((r) => r.relPath),
  )
  const checked: string[] = []
  const seen = new Set<string>()
  for (const r of recommended ?? []) {
    const rel = String(r ?? '').trim()
    if (rel === '' || seen.has(rel) || !known.has(rel)) continue
    seen.add(rel)
    checked.push(rel)
  }
  return { checked }
}

/** 面板打开即扫的默认 parentRoot:只用当前会话 cwd(用户拍板)。偏好里的旧值忽略,免得跨工程串台。 */
export function defaultParentRoot(sessionCwd: string | null | undefined): string {
  const c = String(sessionCwd ?? '').trim()
  return c
}

export interface ScanRepoLike {
  relPath: string
  kind: string
}

/**
 * 扫描回填(ADR-0029 修订):slug 不再从父目录末段取(那是工程名,不是任务缩写)。
 * slug 由任务描述/AI 标题经 suggestSlugFromText 定,本函数只占位回 task(面板随后覆盖)。
 * checked 恒为空——涉及仓不再预勾选,等 task/recommend 按任务描述推荐后再
 * 经 applyRecommendDefaults 合并。
 */
export function suggestScanDefaults(
  _parentRoot: string,
  _repos: ScanRepoLike[],
): { checked: string[]; slug: string } {
  return { checked: [], slug: 'task' }
}

export interface TaskPrefs {
  parentRoot: string
  tasksRoot: string
  templateDir: string
  provider: string
  model: string
}

const PREFS_KEY = 'dshe-task-prefs'

function prefsStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** 读偏好:node/无痕等拿不到 storage 时退化为空偏好,不抛。 */
export function loadTaskPrefs(): TaskPrefs {
  const empty: TaskPrefs = { parentRoot: '', tasksRoot: '', templateDir: '', provider: '', model: '' }
  try {
    const store = prefsStore()
    if (store === null) return empty
    const raw = store.getItem(PREFS_KEY)
    if (raw === null) return empty
    const p = JSON.parse(raw) as Partial<TaskPrefs>
    return {
      parentRoot: typeof p.parentRoot === 'string' ? p.parentRoot : '',
      tasksRoot: typeof p.tasksRoot === 'string' ? p.tasksRoot : '',
      templateDir: typeof p.templateDir === 'string' ? p.templateDir : '',
      provider: typeof p.provider === 'string' ? p.provider : '',
      model: typeof p.model === 'string' ? p.model : '',
    }
  } catch {
    return empty
  }
}

/** 写偏好:写失败静默(偏好丢了只是多填一次,不挡任务)。 */
export function saveTaskPrefs(p: TaskPrefs): void {
  try {
    const store = prefsStore()
    if (store === null) return
    store.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* 忽略 */
  }
}

/**
 * 面板进度快照(ADR-0037):按发起会话存 localStorage,刷新后回到建任务的现场。
 *
 * 为什么按会话存:全局 prefs 曾因跨工程串台被用户否掉(ADR-0036 背景),快照必须带
 * 作用域——同工程同会话才恢复,换会话/换工程一律不碰,宁可白纸。
 * 为什么存 localStorage 不存 task.json:草稿(描述/勾选/slug/tasksRoot 等)是面板
 * 内存态,任务目录是 build 产物;恢复现场 = 「读快照 + 验 taskDir 还在」,
 * 目录没了就报错可一键重建,不静默丢(ADR-0032 fail-loud)。
 */
export interface TaskPanelSnapshot {
  /** 快照版本:以后加字段时旧快照整体作废,不做逐字段迁移。 */
  v: 1
  /** 表单:任务描述原文(面板可改的那份)。 */
  desc: string
  /** 审核后的勾选(涉及仓)。 */
  checked: string[]
  /** AI 理由(勾选旁展示的那份)。 */
  reasons: Record<string, string>
  /** 任务英文缩写。 */
  slug: string
  parentRoot: string
  tasksRoot: string
  templateDir: string
  provider: string
  model: string
  /** 建好的任务目录(完整路径);null = 还没 build。 */
  taskDir: string | null
  /** 拉起的执行会话(repo → sessionId,失败的不记,刷新后只展示 id)。 */
  sessions: Array<{ repo: string; sessionId: string }>
  /** 扫描结构缓存(恢复后免重扫;absPath 留着供 recommend 用,缺了就只能展示);扫不到/过期则重扫)。 */
  repos: Array<{ relPath: string; kind: string; absPath?: string }>
  /** 扫描发生时的父目录:与当前 liveCwd 不一致说明换了工程,不恢复。 */
  scannedRoot: string
}

const SNAP_KEY_PREFIX = 'dshe-task-snapshot:'

function snapKey(sessionId: string): string {
  return `${SNAP_KEY_PREFIX}${sessionId}`
}

/** 快照归一(纯函数,可单测):版本不对/形状不对回 null,不抛;字段逐个收敛(坏字段回空,不整单作废)。 */
export function normalizeTaskSnapshot(p: unknown): TaskPanelSnapshot | null {
  if (p === null || typeof p !== 'object' || (p as { v?: unknown }).v !== 1) return null
  const q = p as Partial<TaskPanelSnapshot>
  return {
    v: 1,
    desc: typeof q.desc === 'string' ? q.desc : '',
    checked: Array.isArray(q.checked) ? q.checked.map(String) : [],
    reasons: q.reasons !== null && typeof q.reasons === 'object' && !Array.isArray(q.reasons)
      ? Object.fromEntries(Object.entries(q.reasons as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]))
      : {},
    slug: typeof q.slug === 'string' ? q.slug : '',
    parentRoot: typeof q.parentRoot === 'string' ? q.parentRoot : '',
    tasksRoot: typeof q.tasksRoot === 'string' ? q.tasksRoot : '',
    templateDir: typeof q.templateDir === 'string' ? q.templateDir : '',
    provider: typeof q.provider === 'string' ? q.provider : '',
    model: typeof q.model === 'string' ? q.model : '',
    taskDir: typeof q.taskDir === 'string' ? q.taskDir : null,
    sessions: Array.isArray(q.sessions)
      ? (q.sessions as unknown[])
        .filter((s): s is { repo: string; sessionId: string } =>
          s !== null && typeof s === 'object'
          && typeof (s as { repo?: unknown }).repo === 'string'
          && typeof (s as { sessionId?: unknown }).sessionId === 'string')
        .map((s) => ({ repo: s.repo, sessionId: s.sessionId }))
      : [],
    repos: Array.isArray(q.repos)
      ? (q.repos as unknown[])
        .filter((r): r is { relPath: string; kind: string; absPath?: string } =>
          r !== null && typeof r === 'object'
          && typeof (r as { relPath?: unknown }).relPath === 'string'
          && typeof (r as { kind?: unknown }).kind === 'string'
          && ((r as { absPath?: unknown }).absPath === undefined
            || typeof (r as { absPath?: unknown }).absPath === 'string'))
        .map((r) => (typeof r.absPath === 'string' && r.absPath !== ''
          ? { relPath: r.relPath, kind: r.kind, absPath: r.absPath }
          : { relPath: r.relPath, kind: r.kind }))
      : [],
    scannedRoot: typeof q.scannedRoot === 'string' ? q.scannedRoot : '',
  }
}

/** 读快照:无/坏/版本不对一律回 null,不抛(坏快照 = 没快照,面板白纸开)。 */
export function loadTaskSnapshot(sessionId: string): TaskPanelSnapshot | null {
  try {
    const sid = String(sessionId ?? '').trim()
    if (sid === '') return null
    const store = prefsStore()
    if (store === null) return null
    const raw = store.getItem(snapKey(sid))
    if (raw === null) return null
    return normalizeTaskSnapshot(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/** 写快照:失败静默(快照丢了只是刷新后白纸,不挡当前任务)。 */
export function saveTaskSnapshot(sessionId: string, snap: TaskPanelSnapshot): void {
  try {
    const sid = String(sessionId ?? '').trim()
    if (sid === '') return
    const store = prefsStore()
    if (store === null) return
    store.setItem(snapKey(sid), JSON.stringify({ ...snap, v: 1 }))
  } catch {
    /* 忽略 */
  }
}

/** 清快照:一键重建/任务作废时调,失败静默。 */
export function clearTaskSnapshot(sessionId: string): void {
  try {
    const sid = String(sessionId ?? '').trim()
    if (sid === '') return
    const store = prefsStore()
    if (store === null) return
    store.removeItem(snapKey(sid))
  } catch {
    /* 忽略 */
  }
}

/** 空快照:白纸开面板时的起点(与各 useState 初值同口径)。 */
export function emptyTaskSnapshot(): TaskPanelSnapshot {
  return {
    v: 1, desc: '', checked: [], reasons: {}, slug: '',
    parentRoot: '', tasksRoot: '', templateDir: '', provider: '', model: '',
    taskDir: null, sessions: [], repos: [], scannedRoot: '',
  }
}
