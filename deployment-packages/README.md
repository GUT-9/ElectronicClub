# 当前云环境：数据库访问优化

本次减少重复查询、会话和全局控制记录写入、稳定公告状态写入，合并并发会话恢复请求，并为公开活动、新闻和资料提供单实例 60 秒缓存。保留登录、RBAC、事务、报名签到、论坛、公告和七牛资料功能。[部署、缓存一致性与回滚说明](../docs/database-efficiency-deploy.md)。

## 你需要执行的顺序

1. **SQL：无需执行。** 不补跑旧初始化脚本，不改已有迁移、成员和管理员密码。
2. **CloudBase：** 下载并核对 [完整云函数 ZIP](electronicclub-api.zip) 和 [SHA256](electronicclub-api.zip.sha256)，替换现有 `electronicclub-api` 代码。入口保持 `index.main`，保留原运行时、HTTP 网关和环境变量。ZIP 根目录直接包含 `index.js`、`package.json`、`package-lock.json` 和全部运行依赖。
3. **EdgeOne：** 重新部署最新 main，包含根目录 `edge-functions`，沿用原构建设置，不能只上传 dist。
4. **环境变量：无需改动。** CloudBase 的数据库、Cookie、Origin、七牛配置和两端原 `ECLUB_PROXY_SECRET` 均保留，不需要新增缓存或配置密钥。
5. **版本核对：** 官网 `/api/health` 响应头应新增 `X-EClub-Data-Revision: db-efficiency-v1`；已有两个网关修复版本头仍为 `gateway-body-v5`。健康检查不连接数据库。

代码和完整 ZIP 在本地准备并测试，推送 main 不代表已经替你上传 CloudBase、执行生产 SQL 或完成手机验收。若 EdgeOne 已启用 Git 自动部署，以其构建发布状态为准。

## 验证结果与范围

- `npm ci` 成功；带隔离本地 PostgreSQL 的 `npm run check` 通过：**88 项测试通过，0 失败、0 跳过**，包含原生 PG、HTTPS RPC、受管角色权限、登录、RBAC、活动报名审核签到、公告和论坛回归，以及原 JSON/编码/同源代理回归。
- 成本回归验证同一实例中 20 个相同的并发公开列表请求仅执行 1 次底层业务事务；权限和会话不缓存，禁用账号仍立即拒绝。包括缓存失效竞态、过期、容量限制、实时公告、分钟级续期、闲置过期、无写入读取仍做 RPC 一致性校验。
- `npm audit --omit=dev`：沿用现有 **3 项 moderate，0 high/critical**，审计退出码 1，不把它记为通过；本次没有新增运行依赖或自动降级 ExcelJS。
- 最终 ZIP 已解压并实际通过 Node 18.15.0 冒烟验证：运行依赖、版本头、未登录 401、布尔/字符串 Base64 标记的 JSON 登录正文和 Secure/HttpOnly Cookie。包大小 12,318,611 字节，SHA256：`cd5e8439d6879dba31e9e40d151bdac2ea1d7875b0c1966fd0b48d3803f25f1a`。
- Linux 临时构建与共用原生数据库代码保持兼容；本次为性能修正，不触发稳定 Linux/运维归档更新。完整 Docker/HTTPS 迁移流程仍由现有 CI 检查，本地未执行服务器部署。

短时缓存属于后端进程内缓存：不同实例或 SQL 手动修改的公开内容可能最多约 60 秒后可见；论坛、定时弹窗、成员、权限、图片和下载地址均不缓存。会话闲置有效期约 29–30 分钟，绝对有效期不变。HTTP/CDN 仍然 `no-store`。

共享 PostgreSQL 按有使用的 5 分钟时段计量，本次优化不保证数据库跨时段休眠，也不能把查询减少比例直接当作资源点节省比例。套餐按月度周期补充额度，优化不会恢复本周期已消耗点数。

## 交付和历史修复

[版本摘要](release-state.json)记录 CloudBase 包对应源码与校验，Linux/运维摘要保留之前版本。本次回滚仅恢复旧函数及前端，无 SQL 回滚。

登录和 QQ 浏览器已由用户确认恢复，继续保留 gateway-body-v5 的字符串/布尔 Base64 标记、ArrayBuffer/DataView 分片、UTF-8、隐私诊断和版本头保护，不恢复旧的内置浏览器限制提示。历史 [网关修复](../docs/gateway-body-deploy.md)、[同源 API](../docs/same-origin-api.md)配置仍适用。
