> 补充：请优先按 [控制台/Agent/私有终端操作手册](cloudbase-console-runbook.md)执行。官方SDK迁移API已核查，新增离线初始化方案；云端操作仍未执行。

# CloudBase 最终部署准备：原生 PostgreSQL

**状态：代码、本地真实 PostgreSQL 测试和 ZIP 准备完成不等于腾讯云部署成功。未连接或迁移真实环境、未创建正式管理员、未改域名/DNS。**

## 方案与证据边界

不再使用 CloudStore 文档 SDK 或假设 pgdoc 支持原 startTransaction/get/set/commit 语义。运行层采用 `pg@8.16.3` 原生 PostgreSQL 协议：真实 BEGIN/COMMIT/ROLLBACK、参数化 SQL、数据库唯一索引及外键。保留 Store/Transaction 业务接口；每个集合对应一张原生表，以 JSONB 保留完整业务档案，并对学号、关联身份、角色关系生成/建立受约束列及索引。user_roles 是实际外键关系表，不依靠浏览器约束。

CloudBase 官方文档站点 https://docs.cloudbase.net/ 在本任务网络中返回代理403，无法独立核实最新套餐能力、当前租户运行时或默认域名额度。参考入口还包括 https://cloud.tencent.com/document/product/876 与 https://edgeone.cloud.tencent.com/pages/document ，本任务不将未读取的页面当作已经验证的证据。现有SDK不能提供本环境事务兼容性的可靠证明，因此按任务要求选择原生PG，而非继续猜测pgdoc。环境ID不是PG连接字符串；不得由它猜测主机、端口或密码。

## 必须先确认的真实环境条件

在控制台或腾讯云支持渠道取得**当前环境实际提供**的PG SQL连接端点、端口、数据库名、CA证书和受限服务账号，确认普通云函数能经套餐允许的网络访问该端点。5432只是本地PG常见端口，不是目标云环境已经确认的端口。

若体验套餐只提供受管HTTP数据库接口、不提供SQL端点/账号，或只允许云托管/VPC而普通函数无法到达，则此原生PG驱动无法直接工作：这是部署阻断，不会回退到内存，也不会自动购买组件或另建数据库。先取得官方支持的访问方式/套餐能力；若只能用另一种网关数据API，需要另做有证据的适配，不能把SDK方法名当作SQL连接证明。

## 运行时与上传

构建开发工具要求Node22.12+。后端部署包目标为Node18，包含真正Node18.15二进制下的运行验证；优先在控制台选择已提供的Node22，若仅有18.15则使用本包。并未假称已查询到租户可选运行时。Node18已结束上游维护，正式上线应迁移到平台支持且仍维护的版本。

```bash
npm ci
npm run check
npm run package:functions
```

上传 `artifacts/electronicclub-api.zip` 到现有 electronicclub-api；解压后根目录为index.js、package.json、node_modules。函数入口 `index.main`。ZIP包含锁定运行依赖，不依赖控制台猜测安装，也不包含真实.env、数据库密码、私钥或会话。保留旧函数版本及设置用于回滚。不要另建域名。

## 环境变量

模板 `cloudbase/backend.env.example`。公开函数仅设置：

- DATABASE_URL：由实际运营方提供的PG URL（包含服务端受限账号，安全注入）。不要放入Vite变量或Git。
- PG_TLS=verify：默认严格验证；PG_CA_CERT：对应端点的PEM CA链。不要使用sslmode=no-verify、rejectUnauthorized=false，URL中也不要夹带会覆盖TLS验证的sslmode参数。PG_TLS=disable仅供本地回环测试，禁止在云端使用。
- ALLOWED_ORIGIN：前端精确HTTPS Origin。COOKIE_SECURE=true。
- 不需要原有CLOUDBASE_ENV_ID或SecretId/SecretKey来替代PG密码；它们不是SQL账号。

连接池每实例最多4条连接，连接超时5秒、语句超时15秒，事务空闲超时30秒。先以函数并发×4核算数据库连接上限，体验环境应限制函数并发。不要创建大连接池或把本地压测容量当作免费配额。

## SQL顺序与数据库权限

仅在确认真正SQL端点可达、做好备份后，用有授权的数据库所有者/迁移角色执行：

1. `cloudbase/sql/001-schema.sql`：11张业务表、迁移记录、唯一学号、FK关系和user_roles。
2. `cloudbase/sql/002-indexes.sql`：筛选、角色、会话、审计、导入索引。
3. DBA通过安全渠道创建 electronicclub_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION；不在SQL文件提交密码。
4. `cloudbase/sql/003-permissions.sql`：拒绝PUBLIC访问，授予该API角色必要DML，不授予DDL/迁移表权限。检查供应商已有anon/authenticated等角色没有通过历史显式GRANT或角色继承获得这些表权限；如有，DBA须撤销，不能只依靠PUBLIC撤销。
5. 公共函数DATABASE_URL只使用该受限角色。PgStore运行时检查并拒绝超级用户/建库/建角色/复制角色。

SQL按自有 electronicclub schema创建，不覆盖供应商系统表。重复执行schema/index迁移可安全跳过已存在对象；若已有同名表但结构不同，先停机审查，不能把IF NOT EXISTS当作自动修复。旧CloudBase文档规则JSON和indexes.json现在仅为历史资料，不能用于PG授权。

## 私有诊断与初始化

下载/解压部署包后，在**有实际数据库网络访问权限的终端**安装Node18.15或更新版本，安全注入上述数据库变量，运行：

```bash
node diagnose.js
```

检查真实连接、事务begin/rollback与角色限制，成功只输出状态标记，不公开主机、用户名、SQL、成员或密码。此机制不是HTTP路由，也不能通过公网函数事件无条件调用。若无法建立安全终端/网络访问，应先解决该阻断，不要开放公开初始化接口。

首次管理员身份由部署者设置 BOOTSTRAP_STUDENT_ID、BOOTSTRAP_NAME、BOOTSTRAP_NICKNAME；BOOTSTRAP_PASSWORD通过安全环境变量读取，至少12位含字母数字。学号允许4–24位ASCII字母数字并大写保留前导零。源码没有个人固定身份或默认超级管理员密码。

```bash
# SQL先由迁移所有者执行；此处使用受限API账号
node bootstrap.js --initialize
```

建立完整用户、哈希、角色、权限、唯一映射和system记录。已初始化则安全退出、不重建；并发初始化由事务锁保护。完成后清除全部BOOTSTRAP变量，不将真实密码保留在公共函数环境。也可在仓库内使用 `npm run bootstrap -w @electronic-club/functions -- --initialize`。私有 `--migrate` 仅供迁移所有者，先设置SQL_DIR指向SQL目录；不通过公开API执行。

## HTTP网关及验收

保留已有默认域名和/api路由，HTTP集成应透传method/path/headers/body/query，映射到index.main。支持原始/api/health与网关剥离前缀后的/health；GET/POST/PATCH/PUT/DELETE及OPTIONS。保持HTTP响应集成识别statusCode/headers/body/isBase64Encoded，否则XLSX会变成Base64文字。

- GET /api/health仅验证进程。
- GET /api/auth/me不带Cookie应401，不能据此判定DB连接已经成功（未认证请求在建连接前拒绝）。
- 从授权终端先跑私有diagnose，再从配置好的Origin以JSON+X-Requested-With: ElectronicClub登录；检查Secure/HttpOnly Cookie、me恢复、强制改密、登出/撤销、角色权限。
- 故意关闭测试数据库应返回503，安全日志可用响应X-Request-ID关联stage/code，不记录原始错误message或连接URL。
- 检查OPTIONS的精确Origin和credentials、Base64 JSON请求以及XLSX下载、二进制响应Content-Type/Content-Disposition。

默认域名仅限开发测试：遵守用户已确认的套餐限制，只进行少量真实联调；不将其用作500人运营方案。当前SameSite=Lax Cookie需要同站点HTTPS前后端或合规的同源接入，不会为绕过默认域名限制而改SameSite/鉴权。EdgeOne同源代理的免费额度、外部代理功能及CloudBase使用许可本次无法取得可验证官方证明，因此**没有实现代理**。免费套餐无法配置正式API域名与持久化SQL访问能力未确认，均为正式上线阻断项；本任务未升级套餐、购买组件、部署代理或修改DNS。

## 数据迁移与回滚

没有自动导入旧集合或修改现有生产数据。若旧系统曾持有资料，先停写、分别导出及加密备份；将UID保持不变，按roles/permissions/users/user_roles/credentials/student_ids/sessions/system/import_jobs/audit_logs/privacy_jobs顺序审查后导入。学号先规范化并检查碰撞，任何重复UID/学号/孤立关系均中止，不覆盖用户。密码哈希原样保留；建议撤销旧会话。先在临时PG库验证计数、权限和最后管理员，再决定切流；不得对自然环境直接DROP/重建schema。

回滚前暂停写入、备份新增PG数据，恢复旧函数版本及对应环境变量；旧文档SDK在PG环境本来不可用，不能宣称恢复旧ZIP就可恢复业务。必要时维护停机并按备份/迁移检查点恢复。提供的SQL没有破坏性down迁移，不能以DROP schema代替回滚。

## 测试与限制

`PG_TEST_URL` 指向本地127.0.0.1的专用club_test数据库时执行真实集成（会清空**该测试schema**，禁止使用生产URL）。没有变量时该测试明确skip，不算数据库通过。当前已在Docker PostgreSQL16验证幂等迁移、原生唯一约束、受限角色、密码登录、RBAC、Excel导入、会话撤销、事务回滚及并发管理员保护；另有原成员HTTP/CSRF/Excel单元回归。

移除旧SDK消除了原lodash.set等高危链；运行npm audit记录仍存在的中危依赖，不把审计当作云端验收。真实TLS、套餐SQL端点、普通云函数网络及域名限制仍需在目标环境验证；本地DB不是该腾讯云环境。

本次实际验证：npm ci、带PG_TEST_URL的npm run check共25项测试全部通过（含真实PG集成，无跳过）；生产构建、ZIP生成通过。Node18.15真实二进制对部署包执行PG诊断、密码登录、Cookie恢复和未登录401通过。SQL需要支持JSONB与生成列的PostgreSQL12+，本地验证版本为16。生产审计10 moderate、0 high/critical，尚需按上游兼容性评估处理中危项；不能因此忽略输入限制、TLS和最小权限。
