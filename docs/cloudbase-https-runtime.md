# 用环境 ID 访问 CloudBase PostgreSQL：HTTPS 运行通道

这是本轮新增的默认运行通道。数据仍在真实 PostgreSQL 中；没有换用文档数据库、内存数据库，也不通过管理 API 模拟跨请求事务。原 TCP 适配器保留，显式设置 `DB_DRIVER=postgres-tcp` 才启用。

**当前交付状态：本地真实 PostgreSQL 和 HTTP 桥接集成测试通过；尚未连接用户的 CloudBase 数据库，未上传函数、执行云端 SQL 或创建正式管理员。** 当前工作区没有目标环境的私有 API Key / 腾讯云管理凭据；默认 API 域名的只读请求也未能从本环境建立连接，不能报告线上已跑通。

## 官方依据及边界

核对腾讯云官方发布 `@cloudbase/node-sdk@3.18.7`：`src/cloudbase.ts` 中 `rdb()` 使用环境 ID 生成 `/v1/rdb/rest`，允许 PostgREST RPC；`src/utils/tcbopenapicommonrequester.ts` 使用 Bearer accessKey。官方客户端依赖的默认端点为 `https://<env>.api.tcloudbasegateway.com/v1/rdb/rest`。本实现使用相同 HTTPS 端点、Bearer 认证、public profile 和 `/rpc/<函数名>`，无需引入整套 SDK 及其额外依赖。

参考：[PostgreSQL 连接文档](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)、[初始化](https://docs.cloudbase.net/database/postgresql/initialization)。文档站点在任务网络中被代理拒绝，依据为上述官方 npm 发布源码；这能证明协议实现存在，**不能证明当前体验套餐允许创建数据库角色、私有 Key 能映射特定 SQL 角色、RPC 已开放或本环境已授予权限**。

环境 ID 负责定位，私有服务端凭据负责认证。单有环境 ID 无法安全登录数据库。不要尝试把 `postgres-...` 实例 ID 当成密码、连接 URL 或可匿名使用的访问令牌。

## 最短安装顺序

### A. 控制台 / 具备相应工具的 Agent

1. 保留已有数据库、函数和 `/api` 网关。先执行 `cloudbase/sql/editor-capability-check.sql` 检查已有表；不要删除供应商 schema。
2. 经授权的 SQL Editor 执行完整 **`cloudbase/sql/editor-https-install.sql`**。这是001、002、创建 NOLOGIN 受限角色、003授权、004 RPC 的完整顺序合集。不要再另外重复执行所有独立文件。可重复执行，不删除已有用户；不兼容的旧表会报错，应停止检查，不能强行覆盖。不同部分独立提交，部分失败后检查并修复再重试，不能当成整份已成功。
3. 取得**仅供服务端使用**的 CloudBase API Key，并由提供方明确确认其实际 SQL 角色映射。如果该角色不是 electronicclub_api，核实该角色不与浏览器/普通用户共用后，按 `005-https-role-binding.sql` 替换占位符并授权。默认文件会拒绝执行；禁止猜测角色名，禁止授予 anon/authenticated/PUBLIC。
4. 若套餐/Editor禁止 CREATE ROLE、GRANT、自定义 RPC，或没有官方支持的私有 Key/SQL角色授权途径，这条通道仍被阻断，需要提供方确认。**不能改成给匿名角色开放低层数据函数。** 管理 API 的迁移权限不等于运行时 Key 的数据权限。

`001/002/004` 也纳入 `scripts/cloudbase-sql.ts` 管理迁移计划；003和受限角色创建需先由有权限的DBA完成。已有001/002迁移内容和版本没有改变；新增004使用新版本，避免修改历史校验和。首次安装直接使用上面的完整Editor文件更直观。

### B. 人工上传 ZIP 和填写环境变量

下载仓库 `deployment-packages/electronicclub-api.zip` 并上传到已有函数 `electronicclub-api`。ZIP 根目录为 index.js/package.json/node_modules，入口 **`index.main`**，支持现有 **Node.js 18.15**。建议函数超时至少60秒，受平台实际配额限制；HTTPS 模式会读取多个记录，Excel每批20行，不能按健康检查的耗时设置超时。Node18已结束上游维护，平台可选时尽快切换仍维护的Node22。

函数运行环境只需填写：

```text
DB_DRIVER=cloudbase-http
CLOUDBASE_ENV_ID=natural-tuna-d6gptlw1w76fa8a63
CLOUDBASE_APIKEY=<私有服务端Key，不是环境ID或前端Key>
ALLOWED_ORIGIN=https://eclub.gut9.cn
COOKIE_SECURE=true
```

HTTPS 模式**不需要 DATABASE_URL、PG_CA_CERT、PG端口、外网开关或TCP连接池配置**。此处使用平台 HTTPS TLS；不会关闭证书验证。不要把初始化密码放进函数持久环境变量。

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
- `npm audit`：完整依赖树22项moderate、0 high/critical；`--omit=dev`为10项moderate、0 high/critical，主要来自Excel/ZIP链。未新增运行依赖。现有XLSX限制、解压大小与条目限制、拒绝公式和服务端鉴权仍保留；不把中风险依赖描述成全部修复。
- 未执行任何CloudBase生产SQL、正式管理员创建、腾讯云配置或DNS修改。
