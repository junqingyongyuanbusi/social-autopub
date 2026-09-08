# 变更台账

## 2026-09-08 — 开放 WikiFX 手动抓取预览

- 用户批准取消截图中手动抓取的语言编辑权限限制。
- `fetchByUrl` 不再检查 `canEdit`；普通用户无需账号分配或语言路由即可读取缓存、抓取正文及强制抓取。
- 保留控制台登录鉴权、API 服务密钥校验、URL 白名单；采用入队的 `canEdit`、列表可见性及其他编辑/审核/发布权限不变。
- 新增 5 个回归用例：普通用户抓取的 3 条路径，以及普通/手动采用的权限拦截。
- 验证：改动前新增抓取用例 3 个均复现 403；改动后 `pnpm --filter api test` 87/87 通过，`pnpm --filter api build` 成功，`git diff --check` 通过。
- 初始交付仅本地修改与提交；线上需更新 API 后生效。
- 后续按用户授权执行 `git push origin dev` 成功；`git ls-remote origin refs/heads/dev` 确认功能提交 `280660fbe1211c8de24c22c0edfcd585a8dee11a` 已到远端。本条推送记录另行提交并同步至同一分支；未执行部署或验证线上生效。
