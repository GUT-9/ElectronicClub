# 同源 API 登录修复与完整部署包

最新小修：[两端代理密钥配置兼容补丁](../docs/proxy-secret-config-fix.md)。**本次无需SQL，需上传本次完整云函数ZIP，再部署EdgeOne最新main（包含根目录edge-functions）。** 两端ECLUB_PROXY_SECRET继续使用之前生成的同一值，无需重新生成；推荐重填为仅64位hex字符。补丁生效后响应头带 `X-EClub-API-Revision: secret-text-v3`。前一个JSON正文兼容修复继续保留。

源码提交 `59db3f9e038d07377dbb8a1d3f29a7e9bb4740bd`。浏览器统一请求官网 `/api`，由根目录 EdgeOne 边缘函数转发到现有后端，处理 Safari/QQ 的跨站 Cookie 问题；登录、RBAC、成员、导入、活动、报名、签到、论坛、公告、正文图片及七牛资料库 API 均保留。

## 本次现有云环境操作清单

1. **SQL：无需执行新SQL。** 已有015及之前迁移保持，不重复初始化数据库或成员。
2. **CloudBase：替换原 electronicclub-api 函数代码。** 上传[完整ZIP](electronicclub-api.zip)，核对[SHA256](electronicclub-api.zip.sha256)，入口仍为 `index.main`，保留原运行时及全部已有环境变量。
3. **为保留真实登录IP，在两端新增相同服务端变量。** 本机用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成64位hex随机值，作为 `ECLUB_PROXY_SECRET` 同时保存到 CloudBase 原API函数环境变量和 EdgeOne 函数运行变量。值必须完全一致，不加VITE前缀，不发到聊天中。仅修复Cookie不依赖此变量；省略会影响真实IP及每IP限流的归属，因此完整升级建议配置。
4. **EdgeOne：从最新main重新部署网页和边缘函数。** 工作目录为仓库根目录，保留原 `npm ci`、`npm run build -w @electronic-club/web`、`apps/web/dist`、Node22；必须同时识别根目录 `edge-functions`，不能只上传dist。旧 `VITE_API_BASE_URL` 可原样保留，新代码不再读取它，无需为浏览器设置新API地址。默认上游已沿用现有网关，无需新增 `API_UPSTREAM_ORIGIN`。
5. **保留原Cookie及来源配置并核对结果。** CloudBase `ALLOWED_ORIGIN=https://eclub.gut9.cn`、`COOKIE_SECURE=true` 继续保留；原 `COOKIE_SAMESITE=none` 暂时不用改，未配置则默认lax即可。发布后访问[官网健康接口](https://eclub.gut9.cn/api/health)应返回JSON，再用Safari登录并刷新、退出。没有控制台凭据，本次交付不代表已经替用户完成云端发布或手机实机验收。

顺序为原函数ZIP与变量 → EdgeOne函数变量及网页/函数一起部署 → 登录核对。本次仅补充交付说明，不重新打包或替换已交付的二进制文件。

## CloudBase

下载 [electronicclub-api.zip](electronicclub-api.zip)，核对 [SHA256](electronicclub-api.zip.sha256)。ZIP 根目录直接包含 index.js、package.json、package-lock.json、全部 node_modules 运行依赖、原迁移及部署文档，入口仍为 **index.main**。大小 12,305,635 字节；SHA-256 `f0a8af6eac8b1caff1b6db46cb7bfc337bcd1b87874c3fe052461fb559d3f619`。

本次无需新 SQL、不初始化账号、不修改密码。若需代理后仍显示成员真实登录 IP，更新原函数 ZIP 并按[同源部署说明](../docs/same-origin-api.md)在 EdgeOne 函数与 CloudBase 原 API 函数配置相同的服务端 ECLUB_PROXY_SECRET。未配置时 Cookie 修复仍可工作，IP 则回退 CloudBase 网关元数据，可能将登录限流聚合到代理节点。

## EdgeOne

从最新 main 在仓库根目录构建，保留 npm ci、npm run build -w @electronic-club/web、apps/web/dist 和 Node22。必须让平台一起部署根目录 edge-functions，不可只上传静态 dist。旧 VITE_API_BASE_URL 不再控制浏览器请求；默认上游沿用现有 CloudBase 网关。上游服务使用许可与配额不因代理而改变。

发布后官网 /api/health 应为 JSON 且带 X-EClub-API-Transport: same-origin，再验证登录、刷新、退出及真实 Safari/QQ。没有平台凭据，不能把本地验证视为生产发布成功。

## Linux 与运维工具

[Linux 完整包](electronicclub-linux.tar.gz) / [SHA256](electronicclub-linux.tar.gz.sha256)已按本次重大更新重建，保留 Caddy 同源 HTTPS、原生 PostgreSQL 与全部后端运行依赖。[运维工具包](electronicclub-operations.tar.gz) / [SHA256](electronicclub-operations.tar.gz.sha256)内容未变化，保留原文件及时间戳。[版本摘要](release-state.json)记录各组件来源；[服务器文档](../docs/linux-server.md)包含备份、恢复和一条命令升级。本次不迁移生产数据库、域名或服务器。

## 验证

npm ci 与 npm run check 通过，69项测试通过、0跳过，含原生 PG/HTTPS RPC、旧直连、权限、CSRF、代理 Cookie/状态/附件、HMAC 伪造及过期拒绝。官方 EdgeOne CLI 配置校验和 Web API 边缘函数编译通过；残留旧 VITE_API_BASE_URL 的构建也保持同源。

实际 Chromium 隔离 HTTPS 开启第三方 Cookie 限制后，表单登录、刷新恢复、退出撤销通过，凭证为仅当前主机的 Secure/HttpOnly/Lax Cookie，所有 API 同源、签名 IP 保留。Linux Docker 中 HTTPS、登录/RBAC、加密备份、篡改拒绝、恢复及实际升级也通过。无真实生产或 iPhone/QQ 客户端验收。

从最终ZIP解压后，实际Node18.15.0验证入口加载、健康检查、签名IP、篡改拒绝和Secure/HttpOnly/Lax Cookie通过，不连接生产数据库。

运行依赖没有新增；npm audit --omit=dev 仍为既有3项 moderate、0 high/critical，退出码1。

原功能部署入口：[活动审核与负责人015](../docs/event-operations-deploy.md) · [成员彻底删除014](../docs/member-purge-deploy.md) · [七牛资料库013](../docs/resources-deploy.md) · [登录记录012](../docs/login-history-deploy.md) · [正文图片011](../docs/content-media-deploy.md) · [论坛009](../docs/stage4-deploy.md)。
