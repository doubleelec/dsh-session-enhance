# dsh-session-enhance

开放辩论 Map：面向开放性论证题，用建构 / 挑战 / 制图三角色产出一套成果地图，而非单一结论。

## Commit messages

Write every commit subject and body in English so the public Git history is accessible to international contributors. Use Conventional Commits: `type(scope): imperative summary` (scope is optional). Keep the subject concise, use an imperative verb, and omit the trailing period. Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and `chore`.

Examples: `fix(session): preserve earlier context` or `docs: clarify install steps`.

## Git remotes

Two remotes: `origin` (git@github.com:doubleelec/dsh-session-enhance.git, public) and `wechat` (git@git.weixin.qq.com:doubleelec/dsh-session-enhance.git, cold backup). Push to both remotes every time: `origin` first, then `git push wechat main`.

## Python / pytest

治理测试统一用 workspace 根的公共 venv 跑:`..\.venv\Scripts\python.exe -m pytest tests/governance -q`。解释器由调用方选,仓内不写死路径、不建 in-repo venv。原因:机器级 `mkdir-0o700-shim` 只在会话创建时给 workspace 内已存在的 venv 打补丁——裸系统解释器跑 pytest 每次都会留一个删不掉的 `pytest-cache-files-*`(0o700 毒化,沙箱零权限删不动)。本仓需要 pin 第三方包版本时再分家(自建 in-repo venv,插件自动盖住)。

## Agent skills

### Issue tracker

Issues live as local markdown under `docs/efforts/`. See `docs/agents/issue-tracker.md`.

### Temp files

Throwaway artifacts go in `.tmp/` (gitignored; any session may clear it without asking). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context glossary (`GLOSSARY.md` + `docs/adr/`).
