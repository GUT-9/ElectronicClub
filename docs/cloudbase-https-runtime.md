> **托管PG权限修复：** 默认安装SQL复用已经确认存在的`service_role`，不再创建electronicclub_api，也不需要CREATEROLE权限。匿名角色和普通登录角色没有成员数据/RPC授权。云函数令牌实际SQL角色必须为service_role，仍需真实环境验证。

> **最新修复：** 默认复用SCF平台注入的临时执行身份，不再强制填写CLOUDBASE_APIKEY。实现依据为官方node-sdk 3.18.7的prepareCredentials、auth.getClientCredential和签名请求器。仍需验证执行角色IAM权限、令牌对应的SQL角色授权、RPC安装及管理员初始化；本地测试不能证明腾讯云已部署成功。

# 用环境 ID 访问 CloudBase PostgreSQL：HTTPS 运行通道

这是本轮新增的默认运行通道。数据仍在真实 PostgreSQL 中；没有换用文档数据库、内存数据库，也不通过管理 API 模拟跨请求事务。原 TCP 适配器保留，显式设置 `DB_DRIVER=postgres-tcp` 才启用。

**当前交付状态：本地真实 PostgreSQL 和 HTTP 桥接集成测试通过；尚未连接用户的 CloudBase 数据库，未上传函数、执行云端 SQL 或创建正式管理员。** 当前工作区没有目标环境的私有 API Key / 腾讯云管理凭据；默认 API 域名的只读请求也未能从本环境建立连接，不能报告线上已跑通。

## 官方依据及边界

核对腾讯云官方发布 `@cloudbase/node-sdk@3.18.7`：`src/cloudbase.ts` 中 `rdb()` 使用环境 ID 生成 `/v1/rdb/rest`，允许 PostgREST RPC；`src/utils/tcbopenapicommonrequester.ts` 使用 Bearer accessKey。官方客户端依赖的默认端点为 `https://<env>.api.tcloudbasegateway.com/v1/rdb/rest`。本实现使用相同 HTTPS 端点、Bearer 认证、public profile 和 `/rpc/<函数名>`，无需引入整套 SDK 及其额外依赖。

参考：[PostgreSQL 连接文档](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)、[初始化](https://docs.cloudbase.net/database/postgresql/initialization)。文档站点在任务网络中被代理拒绝，依据为上述官方 npm 发布源码；这能证明协议实现存在，**不能证明当前体验套餐允许创建数据库角色、私有 Key 能映射特定 SQL 角色、RPC 已开放或本环境已授予权限**。

环境 ID 负责定位，云函数执行身份负责认证；显式私有API Key只是可选通道。单有环境 ID 无法安全登录数据库。不要尝试把 `postgres-...` 实例 ID 当成密码、连接 URL 或可匿名使用的访问令牌。

## 最短安装顺序

### A. 控制台 / 具备相应工具的 Agent

1. 保留已有数据库、函数和 `/api` 网关。先执行 `cloudbase/sql/editor-capability-check.sql` 检查已有表；不要删除供应商 schema。
2. 经授权的SQL Editor执行完整 **`cloudbase/sql/editor-https-install.sql`**。脚本把001、002和新006托管角色授权/RPC合并到一个事务；复用既有service_role，不包含CREATE ROLE或角色成员关系调整。已创建的表可保留，脚本可重试，数据不会被重建。执行失败需停止并保留第一条错误。
3. 脚本预检查service_role存在、非superuser/建库/建角色/复制角色，并确认anon/authenticated不能继承服务角色或私有数据所有者权限。它仅授权本应用私有schema及ec_*函数，不修改供应商角色定义；不会授予匿名或普通登录角色成员数据权限。
4. 云函数默认使用平台临时执行身份换令牌。**存在service_role不等于令牌已映射到它**；实际RPC调用必须以service_role执行，管理SQL账号即使拥有这些表也不会被RPC自动当成服务端身份。SQL安装后再实际登录/诊断验证，不能换成匿名角色或管理账号绕过检查。
5. `001/002/003/004/005`保留给原生PG/自建受限角色的旧路径；托管环境不要再执行005去修改平台角色成员关系。已有表仅需补权限/RPC时，可执行单独的 **006-managed-service-role.sql**；通常直接重跑完整安装文件更省事。

管理API迁移可显式使用 `scripts/cloudbase-sql.ts --managed --preview`，通过后 `--managed --apply --confirm-env=<env>`。该计划使用原有001/002及新版本006；没有修改已发布004的内容/校验和，不删除历史。管理API调用和当前SQL角色授权能力仍需真实IAM验证。未加--managed时保留旧自建角色计划，不适用于当前无法创建角色的托管SQL账号。

### B. 人工上传 ZIP 和填写环境变量

下载仓库 `deployment-packages/electronicclub-api.zip` 并上传到已有函数 `electronicclub-api`。ZIP 根目录为 index.js/package.json/node_modules，入口 **`index.main`**，支持现有 **Node.js 18.15**。建议函数超时至少60秒，受平台实际配额限制；HTTPS 模式会读取多个记录，Excel每批20行，不能按健康检查的耗时设置超时。Node18已结束上游维护，平台可选时尽快切换仍维护的Node22。

函数运行环境只需填写：

```text
DB_DRIVER=cloudbase-http
CLOUDBASE_ENV_ID=natural-tuna-d6gptlw1w76fa8a63
ALLOWED_ORIGIN=https://eclub.gut9.cn
COOKIE_SECURE=true
```

默认不需要手填CLOUDBASE_APIKEY；临时凭据由平台注入，不显示在用户自定义环境变量列表里不代表必然缺失。需要从实际日志确认。HTTPS 模式**不需要 DATABASE_URL、PG_CA_CERT、PG端口、外网开关或TCP连接池配置**。此处使用平台 HTTPS TLS；不会关闭证书验证。不要把初始化密码放进函数持久环境变量。

### C. 受保护独立终端：检查与一次性初始化

解压同一ZIP，安全注入上面的变量，然后运行：

```bash
node deploy-preflight.mjs
node diagnose.js
# 临时安全设置BOOTSTRAP_STUDENT_ID、BOOTSTRAP_NAME、BOOTSTRAP_NICKNAME、BOOTSTRAP_PASSWORD
node bootstrap.js --initialize
# 完成后清除BOOTSTRAP_*变量
```

diagnose实际调用数据库读取及原子提交RPC；成功会打印 `httpsRpc:true,transactionRoundtrip:true`，不打印Key/档案。失败不输出原始响应，以免泄密；HTTP401/403在服务日志对应RDB_HTTP_PERMISSION_DENIED，网络错误对应RDB_HTTP_UNREACHABLE。标准PostgREST错误中的缺少RPC对应RDB_RPC_NOT_INSTALLED、缺少表对应RDB_SCHEMA_NOT_INSTALLED；其他SQL/HTTP异常对应RDB_HTTP_FAILED。健康200、匿名me401不能替代此检查。

bootstrap 支持字母学号、大写规范化、前导零和 nickname；密码至少12位含字母数字，仅保存scrypt哈希。首次初始化原子创建用户、凭据、学号映射、7个初始角色、权限、user_roles、system/control及审计。重复初始化安全退出；并发初始化只能成功一次。没有公开HTTP初始化接口。终端无法访问RPC时，仍可用包内 `offline-bootstrap.js --output=/secure/eclub-bootstrap-private.sql` 在本机生成带哈希的私有SQL，再由授权Editor整事务执行；该文件含个人信息/哈希，不要提交Git或交给不可信Agent。

## 事务为何可靠

`HttpStore` 将读取版本和全部写入收集到一次 `ec_commit`。SQL函数内部取得与TCP适配器相同的事务锁，验证所有读取版本（包括记录不存在），冲突不写入并由客户端重试，成功则在一个原生PostgreSQL事务内写入全部表和user_roles。唯一索引/外键失败会回滚整次提交。没有跨HTTP调用维持BEGIN/COMMIT的假设。所有ec_*函数均 SECURITY INVOKER，拒绝超级用户/建库/建角色/复制角色；PUBLIC无执行权限，数据schema不向浏览器开放。公开API的会话、首次改密、CSRF、RBAC仍在原业务层独立校验。

## 验收与未完成的生产条件

在已授权终端配置 `VERIFY_API_BASE` 为现有默认API域名、`VERIFY_ORIGIN=https://eclub.gut9.cn`，先 `node verify-api.mjs --public-only`；再临时安全填写 VERIFY_STUDENT_ID / VERIFY_PASSWORD 执行 `node verify-api.mjs`，验证真实登录、Set-Cookie、会话恢复、管理员权限、登出撤销。不要在聊天中发送密码/Key。数据库诊断必须单独成功，不能把匿名401当作数据库可用。

默认 app.tcloudbase.com 网关仍仅用于少量开发测试。HTTPS数据库通道解决了TCP依赖，**不会自动解决API默认域名生产限制、免费套餐自定义域名限制，或eclub.gut9.cn与默认域名跨站Cookie的问题**。保留Secure/HttpOnly/SameSite=Lax和CSRF；未建立合规的正式同站点API入口前，不能宣称前端正式登录已可运营。不新增付费服务、不用代理绕过默认域名生产限制。

回滚：保留旧函数版本和环境配置；恢复旧ZIP时同时恢复 DB_DRIVER=postgres-tcp 及原TCP变量（前提是该通道原本可用）。新RPC可留在数据库中，不删除业务表或数据。没有TCP可用时旧版本无法解决现有503，不要把回滚当作连接方案。

## 本轮验证记录

- `npm ci`、`npm run check`通过：29个测试全部执行，包含本地真实PostgreSQL16的TCP及HTTP RPC集成测试；不是内存替代。
- 完整部署目录另在真正Node.js18.15.0下验证 `index.main` 健康/匿名401/登录/Set-Cookie/会话恢复/超级管理员权限，以及 `diagnose.js` 和重复bootstrap安全退出。该验收使用本地HTTP桥接到真实PG，不是腾讯云部署验收。
- `npm audit`：完整依赖树22项moderate、0 high/critical；`--omit=dev`为10项moderate、0 high/critical，主要来自Excel/ZIP链。初版未新增运行依赖；本轮身份修复新增官方签名库2.2.2，完整审计仍为22项moderate、无high/critical。现有XLSX限制、解压大小与条目限制、拒绝公式和服务端鉴权仍保留；不把中风险依赖描述成全部修复。
- 未执行任何CloudBase生产SQL、正式管理员创建、腾讯云配置或DNS修改。


## 登录503的分阶段定位

只复制安全日志中的requestId/stage/code，不发送密码、Token、Cookie、SecretId/SecretKey。

- runtime_identity / CLOUDBASE_IDENTITY_UNAVAILABLE：没有可用的平台执行身份或显式服务端Key。检查云函数执行角色/临时凭据注入；不要求自行编造Key。
- identity_exchange / CLOUDBASE_IDENTITY_REJECTED：平台身份换令牌被拒绝，核查执行角色、目标环境权限；没有弱化SQL授权。
- identity_exchange / CLOUDBASE_IDENTITY_UNREACHABLE：换令牌服务不可达。
- http_rpc / RDB_HTTP_PERMISSION_DENIED：已到数据接口，但数据库角色或RPC执行权限不足。不能给匿名角色授权来绕过。
- http_rpc / RDB_RPC_NOT_INSTALLED、RDB_SCHEMA_NOT_INSTALLED：SQL安装缺失。
- 接口NOT_INITIALIZED：数据库可访问，但还没有完成一次性管理员初始化。**只设置BOOTSTRAP_PASSWORD不会自动创建账号**；仍需受保护bootstrap或私有离线SQL。密码只写哈希。

签名库采用官方@cloudbase/signature-nodejs 2.2.2，运行依赖已纳入独立锁文件和ZIP。不引入整套SDK，不记录原始身份错误或令牌。并发请求共享令牌交换，按有效期提前刷新，平台临时凭据轮换时重新交换；SQL权限边界保持不变。

本轮身份修复验证：npm ci与npm run check通过，31项测试全部执行；Node18.15完整部署目录通过签名换令牌（本地测试网关）、真实本地PG登录/Cookie/RBAC、诊断及重复初始化。临时凭据与令牌均为测试值，不连接腾讯云真实身份服务。实际平台凭据注入与SQL角色映射仍须云端验收。


## 已到http_rpc阶段、但只有RDB_HTTP_FAILED时

这表示后端已尝试调用SQL REST/RPC接口，尚不能据此断言表已创建、角色授权正确或令牌已被SQL接口接受。云函数外层执行日志status_code:200不等于API成功；应读取返回对象中的statusCode（如503）。

先在SQL Editor执行 `cloudbase/sql/editor-login-check.sql`（只读）：表或函数为NULL时，先完成对应SQL安装；已存在时不要删除、重建用户表。SQL安装不会随上传ZIP自动执行。存在性检查不证明函数运行身份的权限。

新版错误日志保留upstreamStatus、允许列表中的upstreamCode、可识别的upstreamRequestId、operation和responseKind。例如INVALID_PATH会映射为RDB_ENDPOINT_NOT_AVAILABLE；PGRST106为RDB_SCHEMA_NOT_EXPOSED；嵌套的PostgREST错误也会识别。未知代码记为UNRECOGNIZED，不输出message/details/hint、原始HTML/JSON或凭据。前端继续返回通用503，不公开内部诊断。

当表和RPC均存在但仍失败时，上传新版ZIP后只提供这条安全JSON日志即可继续定位，不需要重新调整前端地址或提供密码。本轮诊断改动不是腾讯云数据库部署成功的证明。


## 托管角色适配的实际测试

完整check含34项测试，全部执行。新增测试在本地真实PG中由NOCREATEROLE、NOSUPERUSER的数据库所有者执行整份安装SQL，验证可重复安装、原子失败回滚、保留用户与会话、service_role下初始化/登录/RPC事务，以及anon/authenticated无法读取用户/凭据/会话或调用ec_read。测试中还确认把service_role授予authenticated后安装会拒绝执行。

这是本地PG权限语义验证；CloudBase上的GRANT/函数创建、令牌角色映射、正式管理员创建均未由本任务执行或报告成功。此轮只改SQL及运维工具，已上传且能到http_rpc阶段的函数不需要为这次SQL角色修复重新上传；仓库ZIP同时更新SQL资源以保持一致。

SQL由 `npm run sql:generate` 生成，`npm run check`包含一致性检查。今后修改原003/004模板后需重新生成托管SQL；不要手工编辑生成文件造成两套权限不一致。
