#!/usr/bin/env node
/**
 * 投递脚本(npm run deliver):拷四文件到 web profile → 打版本探针对账。
 *
 * 为什么需要它(profile 装的是 file: 副本,不是链接):
 * 源码改了、构建了,host 跑的还是旧包——不拷这四文件,面板/占位链全是旧逻辑,
 * 且没有任何提示。投递后读 /api/version 对账:
 * - running == 磁盘版本 且 stale=false → 生效,可直接验证。
 * - stale=true / 404 / 连不上 → 磁盘已新、进程仍旧,必须重启宿主才生效。
 *
 * 不在脚本里调 npm run build:沙箱禁子进程 stdio,spawn 会 EPERM。
 * 先自己跑 `npm run build`,再跑本脚本(脚本会校验 lib 比 src 新,旧了就停)。
 *
 * 用法:npm run deliver [-- --profile web] [-- --port 3080]
 * 退出码:0=已投递且探针显示生效;1=已投递但需重启宿主;2=投递本身失败。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()

const parseArg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--')) return String(process.argv[i + 1])
  const pref = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (pref) return pref.slice(name.length + 3)
  return def
}
const profile = parseArg('profile', 'web')
const port = parseArg('port', '3080')

const fail = (msg) => { console.error(`deliver: FAIL: ${msg}`); process.exit(2) }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
const version = String(pkg.version ?? '')
if (version === '') fail('package.json 里读不到 version')

// 1) 校验构建新鲜度:lib 比 src 旧说明忘构建了,直接停(不在脚本里构建:
// 沙箱禁子进程 stdio,spawn 会 EPERM;先自己跑 `npm run build`)。
const newestSrc = (dir) => {
  let newest = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) newest = Math.max(newest, fs.statSync(p).mtimeMs)
    }
  }
  walk(dir)
  return newest
}
{
  const srcNew = newestSrc(path.join(root, 'src'))
  const libIndex = path.join(root, 'lib', 'index.js')
  if (!fs.existsSync(libIndex)) fail('lib/index.js 不存在,先跑 `npm run build`')
  const libNew = fs.statSync(libIndex).mtimeMs
  if (libNew < srcNew) fail('lib 比 src 旧(改了代码没构建),先跑 `npm run build` 再投递')
  console.log(`deliver: 构建新鲜度 OK(源码 v${version})`)
}

// 2) 拷四文件:host 逻辑 + 界面 + 两份版本真值。
const files = ['lib/index.js', 'lib/client.js', 'package.json', 'dsh.plugin.json']
for (const f of files) {
  if (!fs.existsSync(path.join(root, f))) fail(`构建产物缺失: ${f}`)
}
const dest = path.join(os.homedir(), '.dsh', 'profiles', profile, 'node_modules', '@doubleelec', 'dsh-session-enhance')
if (!fs.existsSync(dest)) fail(`profile 目录不存在: ${dest}(先确认 profile 名,当前=${profile})`)
for (const f of files) {
  fs.mkdirSync(path.join(dest, path.dirname(f)), { recursive: true })
  fs.copyFileSync(path.join(root, f), path.join(dest, f))
  console.log(`deliver: copied ${f} → profile/${profile}`)
}

// 3) 探针对账:读磁盘 manifest + 问 host 真正在跑的版本。
let disk = null
try {
  disk = JSON.parse(fs.readFileSync(path.join(dest, 'dsh.plugin.json'), 'utf-8')).version ?? null
} catch { /* 读不到就只报 host 侧 */ }
console.log(`deliver: disk(profile 副本)版本=v${disk ?? '?'}`)
const url = `http://127.0.0.1:${port}/dsh-session-enhance/api/version`
let body = null
try {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  body = await res.json()
} catch (e) {
  console.log(`deliver: 探针打不到 host(${url}): ${e instanceof Error ? e.message : String(e)}`)
  console.log('deliver: 文件已投递,但 host 没在跑或路由还是旧的——请启动/重启宿主后再验证。')
  process.exit(1)
}
const running = body?.running ?? body?.version ?? '?'
const stale = body?.stale === true
const reason = body?.reason ?? null
const hold = body?.holdTool ?? null
console.log(`deliver: host 在跑版本=v${running} stale=${stale}${reason ? ` reason=${reason}` : ''}`)
console.log(`deliver: holdTool=${JSON.stringify(hold)}`)
if (stale || String(running) !== version) {
  console.log(`deliver: 已投递 v${version},但 host 仍在跑 v${running}——请重启宿主后再验证(面板 stale 横幅会自己消失)。`)
  process.exit(1)
}
console.log(`deliver: OK,host 已在跑 v${running},与源码一致,直接验证即可。`)
