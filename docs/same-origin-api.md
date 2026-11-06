# 同源 API：Safari 与 QQ 会话修复

浏览器统一请求官网 `/api`。EdgeOne 根目录 `edge-functions/api/index.ts` 和 `edge-functions/api/[[path]].ts` 转发到现有 CloudBase HTTPS 后端，Linux 继续使用 Caddy，本地开发继续使用 Vite。原认证、服务端会话、数据库、RBAC和CSRF均沿用；不新增数据库、不重置密码，不把令牌放进localStorage。

前端请求、健康检查、下载、论坛图片、正文图片全部使用同源相对地址。旧 `VITE_API_BASE_URL` 不再控制浏览器请求，避免控制台残留值导致登录仍然跨站。这里解决浏览器访问入口，不更改CloudBase套餐、默认域名许可或上游配额。

## 升级顺序

1. 若要保留准确登录IP，先更新现有CloudBase函数为本次 `deployment-packages/electronicclub-api.zip`，入口仍为 `index.main`，保留原全部变量；本次没有SQL迁移。新函数兼容旧网页的直连请求。
2. EdgeOne从最新main以仓库根目录构建，保留 `npm ci`、`npm run build -w @electronic-club/web`、`apps/web/dist`、Node22。必须包含根目录 `edge-functions`，由平台一起编译，不能仅上传静态dist。已有main自动部署则等待该次部署完成。无需新增前端构建变量。
3. 后端保留 `ALLOWED_ORIGIN=https://eclub.gut9.cn`、`COOKIE_SECURE=true`。默认 `COOKIE_SAMESITE=lax` 即可；现有none值可先保留，同源方案不依赖它放开第三方Cookie。不要增加Cookie Domain。
4. 实际打开 `https://eclub.gut9.cn/api/health`，应返回API JSON，响应头含 `X-EClub-API-Transport: same-origin`。登录与紧接的me也必须都访问官网域名，刷新后保持，退出后me401。最后在真实iPhone Safari与QQ/微信验收。

若只需修复跨站Cookie，可先部署EdgeOne新代码，代理兼容当前后端；第1步的新包与下面签名配置用于保留准确IP。没有配置签名时，后端仍只信任原CloudBase网关IP，日志和每IP限流可能聚合到边缘节点，不能据此宣称记录到成员真实IP。

## 固定上游与登录 IP

默认上游为项目现有CloudBase HTTPS网关，代码仅在服务端使用。更换为平台支持的正式上游时，在EdgeOne **函数运行变量** 设置 `API_UPSTREAM_ORIGIN=https://你的后端源地址`（无尾部斜杠、无/api、无账号密码/查询）。不能指向官网本身，否则会形成环路并被拒绝。请求中的url、host、query不决定上游。

按用户要求，先更新两端代码，然后在 **EdgeOne函数运行变量** 和 **CloudBase原API函数环境变量** 中将同名 `ECLUB_PROXY_SECRET` 填为相同4位数字，例如 `1234`。不需要运行生成命令；只填值，不加VITE前缀。原64位hex配置也继续兼容。

两端共用相同的密钥规范化逻辑，清理复制空白、配对引号及明确的赋值前缀，再校验4位数字或原64位hex。[密钥格式报错及升级清单](proxy-secret-config-fix.md)说明完整操作。错误提示不会回显配置内容。

4位值易被猜到，可被用于伪造代理IP元数据，不提供可靠的真实IP防伪能力。此配置只作用于IP签名；成员登录密码、服务端会话和权限校验保持原逻辑。

边缘函数只读取平台 `context.eo.clientIp`，从不采用用户的X-Forwarded-For；清除请求中的伪造签名并用HMAC-SHA256签名IP、时间和浏览器信息。后端只在密钥、签名、真实IP格式和60秒时间窗都有效时采用，记录来源为trusted-header；无效/过期/未配置时回退网关元数据，不接受客户端随意指定IP。直连旧API保持兼容。密钥轮换时协调两端更新，短暂不匹配会回退网关IP。

## 请求和缓存边界

- 仅代理/api及子路径，站点其他页面继续原SPA规则，静态文件不被代理。GET、HEAD、POST、PUT、PATCH、DELETE、OPTIONS均保留。
- 保留方法、原始查询参数、JSON正文、Origin、CSRF请求头、浏览器信息；只转发本站会话Cookie，不发送其他网站或平台Cookie。
- 原样保留HttpOnly/Secure会话下发和退出清除、401/403/413/429等状态、JSON、图片与XLSX附件；API双层no-store并关闭平台路径缓存。
- 固定HTTPS上游，不跟随后端重定向、不转发调用者Authorization，不把失败请求回退成跨站fetch；错误中不返回凭据或内部异常。
- 逐块累计校验请求大小，上限延续3.1MB；原业务64KB内容请求和图片分片限制仍执行。函数55秒上游超时；EdgeOne与CloudBase自身限制仍适用，代理不提高原额度。

## 部署诊断与回滚

/api/health为404/HTML：检查平台是否识别edge-functions、根工作目录及是否只上传静态文件；API不能重写成index.html。502：核对上游HTTPS可达性和当前环境的出站限制；503配置错误：核对API_UPSTREAM_ORIGIN与4位数字配置（原64位hex仍兼容）。不要通过关闭TLS验证来修复。

预览域名仍受后端精确Origin限制，未独立授权的预览站不能执行写操作；代理不伪造Origin放行预览。正式域名切换、额外服务或付费套餐不由本次代码自动创建。当前执行环境没有云控制台凭据，生产发布及真实手机验收以平台实际部署结果为准。

若平台不支持根目录边缘函数，先恢复前一个完整EdgeOne部署（网页与函数同时恢复），再选择平台支持的同站点API域名方案。仅回退成旧的跨站网页会恢复原Safari问题，不应视为兼容性修复。后端新ZIP向后兼容，不必回退数据库或重新初始化成员。

## 官方格式依据

函数路由、onRequest/context.env/context.eo.clientIp对照官方 `edgeone@1.6.47`、`@edgeone/types@1.0.2`；catch-all文件格式见[腾讯官方functions-fetch示例](https://github.com/TencentEdgeOne/pages-templates/tree/main/examples/functions-fetch)。本地Web API编译/隔离测试不能替代真实账号的EdgeOne发布与Safari/QQ实机验收。

验证：`npm ci`和`npm run check`通过，69项测试通过、0跳过，包含原生PG和HTTPS RPC回归、签名篡改/过期/伪造拒绝、旧直连兼容、登录/会话恢复/退出、RBAC/CSRF、请求预算及二进制附件透传。官方CLI `edgeone validate`通过，边缘函数独立按Web API环境打包通过。另用实际Chromium在隔离HTTPS站点启用第三方Cookie限制，完成官网表单登录、刷新恢复、退出撤销；Cookie仅属当前主机，Secure/HttpOnly/Lax，JavaScript不可读，所有API同源，签名登录IP保留。此测试使用隔离假账号，不是线上或真实iPhone/QQ验收。依赖未新增，`npm audit --omit=dev`仍为既有3项moderate、0 high/critical（退出码1）。

更新后的Linux版本也通过隔离Docker中的PostgreSQL17、Caddy HTTPS登录/RBAC、加密备份、篡改拒绝、恢复切换、同版本不升级及新版本实际升级验收，账号、密码、报名、配置和密钥保留。运维脚本及其归档内容没有变化，重大更新发布时保留原运维包。
