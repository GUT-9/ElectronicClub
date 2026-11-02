# 最终操作手册：控制台、人工上传、私有终端

## 已核实与未核实

五个指定文档地址本轮逐一请求均被工具网络代理403拒绝；没有伪称已经读取正文。可替代的官方发布源码已核对：

- @cloudbase/manager-node **5.9.4**：types/database/index.d.ts 与 lib/database/index.js 提供 executePGSql({Sql,Role?,EnvId?})、previewPGUserMigrations、pushPGUserMigrations、describeTaskResult。
- @cloudbase/cli **3.8.11**：dist/standalone/cli.js 的 runPgSql 使用 executePGSql；`tcb db pg migration up -e <env> --dry-run` 使用preview，执行时使用push与任务查询。
- 官方管理SDK DatabaseDeployer 消费完整SQL文件，预览Executable/Conflicts后提交，等待Status=Succeed；迁移Version必须14位数字，Name仅小写字母与下划线。

这证明接口存在及调用签名，不证明当前环境有IAM权限、套餐开放、任意DDL权限，亦不证明多次ExecutePGSql共享连接或事务。本任务未调用真实管理API，没有取得真实DATABASE_URL或执行云端SQL。

## A：控制台或有实际工具的 Agent

1. 查看已有环境/函数/运行时和网关配置，不创建新域名。Agent若没有对应工具，应只给出说明，不能声称已执行。
2. 在可用SQL Editor先运行 `cloudbase/sql/editor-capability-check.sql`，人工私下审查版本、当前角色、electronicclub已有表结构。不得删除现有表或供应商schema。
3. 若Editor支持完整多语句事务，执行 `cloudbase/sql/editor-schema-indexes.sql`。这是001和002的完整副本，包含两个独立事务；不要按分号拆分DO $$块。若多语句/事务不被支持，停止，改用已授权终端或提供方明确支持的迁移服务。
4. 角色创建/GRANT由有权限的DBA确认：`003-permissions.sql` 是可复制授权文件，但没有角色密码，也不自动创建LOGIN。SQL Editor若禁止CREATE ROLE或GRANT，Agent不能绕过，需控制台提供的数据库账号管理功能/提供方支持；没有受限SQL账号则API部署受阻。
5. 依据服务日志的X-Request-ID检查安全stage/code。健康200和匿名me401不证明数据库连接可用。

## B：用户手动上传与配置

1. 下载 `artifacts/electronicclub-api.zip`，在**已有**electronicclub-api控制台上传完整ZIP，入口index.main。根目录包括index.js、node_modules、package.json、diagnose.js、bootstrap.js、offline-bootstrap.js、sql/。不要让Agent假装读取Codex本地ZIP或GitHub Actions产物。
2. 模板 `cloudbase/backend.env.example`。手动安全填写DATABASE_URL、PG_CA_CERT、PG_TLS=verify、ALLOWED_ORIGIN=https://eclub.gut9.cn、COOKIE_SECURE=true。DATABASE_URL必须由真实PG控制台/提供方给出，环境ID不能转换出端点。
3. 默认/API域名不能与eclub.gut9.cn构成同站点Cookie。保持SameSite=Lax，不弱化CSRF或鉴权。默认域名仅用于少量开发测试，不能据此宣称前端生产登录已可用。
4. 保留/api网关及HTTP集成：statusCode、headers（包括Set-Cookie）、body、isBase64Encoded必须被正确解释。XLSX应返回附件而非Base64文本。
5. 记录函数并发上限及真实数据库max_connections/账号连接限制。执行离线预算检查前设置FUNCTION_MAX_CONCURRENCY和PG_CONNECTION_LIMIT；预算为每实例4连接加至少2条运维余量。该公式只是保守下限，弹性实例重叠仍需额外预留。

## C：受保护独立终端

仓库中的TypeScript/tsx管理工具使用Node22.12+及npm ci；ZIP内已编译的私有JS命令兼容Node18.15。两者不要混淆。

### 无数据库TCP时：官方管理API迁移

管理API走腾讯云HTTPS身份验证，可独立于函数TCP执行SQL；它不解决API运行时的TCP连接问题。

```bash
# 在独立工具目录安装官方管理SDK，不装到公共函数中
npm install --prefix /secure/cloudbase-tools @cloudbase/manager-node@5.9.4
# 安全设置TENCENTCLOUD_SECRETID/SECRETKEY及可选SESSIONTOKEN，不在命令参数/聊天传值
export CLOUDBASE_MANAGER_PATH=/secure/cloudbase-tools/node_modules/@cloudbase/manager-node
export CLOUDBASE_ENV_ID=natural-tuna-d6gptlw1w76fa8a63
# 在仓库根目录，先纯离线检查
node --import tsx scripts/cloudbase-sql.ts --plan
# 以下才会联系云端；本任务没有执行这些命令
node --import tsx scripts/cloudbase-sql.ts --probe
node --import tsx scripts/cloudbase-sql.ts --preview
node --import tsx scripts/cloudbase-sql.ts --apply --confirm-env=natural-tuna-d6gptlw1w76fa8a63
```

工具使用官方预览、批量迁移和任务API，仅包含schema/indexes，不自动执行角色授权。Executable=false/Conflicts非空即停止；已应用则跳过；返回异步任务后必须Succeed才算成功，超时/失败不能当作成功，不会自动repair历史或include-all。

`--probe-batch` 可显式测试单次 ExecutePGSql 对 `BEGIN;SELECT 1;ROLLBACK;` 的接受情况。SDK只有一个Sql字符串，没有“跨调用会话句柄”；**批处理被接受也不能证明跨请求事务或所有DDL/GRANT都被允许**。不要分别发送BEGIN、DDL、COMMIT并假定连接相同。原业务数据库仍用pg真实事务，不改成管理API。

本地迁移工具移除了原文件最外层BEGIN/COMMIT以避免嵌套管理迁移事务；其中DO块不拆分。远端迁移原子性/DDL权限没有在目标环境验证，须先预览，并对失败可能产生的部分DDL做只读检查。DDL本身幂等、不删除用户数据；已有表不兼容时会失败，不能覆盖。第一次应用后不要修改固定版本内容；更改结构应增加新版本。管理SDK是独立运维依赖，需在私有工具环境单独审计，不进入公开ZIP。

### 有TCP后：部署前检查和初始化

```bash
node scripts/deploy-preflight.mjs
# 解压后的部署目录；安全设置数据库变量
node diagnose.js
# 只有真实网络、TLS、权限检查通过后初始化
node bootstrap.js --initialize
```

必须从函数所处网络或提供方明确等价的网络验证TCP。仅终端能连通并不证明函数可连通。diagnose检查真实事务和受限账号；连接URL中禁止sslmode绕过，非回环端点不允许PG_TLS=disable。

初始化资料分别通过BOOTSTRAP_STUDENT_ID、BOOTSTRAP_NAME、BOOTSTRAP_NICKNAME安全输入；密码通过临时BOOTSTRAP_PASSWORD提供（至少12位含字母数字）。源码没有硬编码身份。完成后清理变量，不将密码留在公共函数持久配置。

### 离线一次性初始化SQL（不需要生成端TCP）

若Agent不能运行私有脚本，但SQL Editor确认支持完整事务和所需写入，可在独立受保护终端生成：

```bash
# 仓库中，或解压部署包使用offline-bootstrap.js
node --import tsx apps/functions/src/offline-bootstrap.ts --output=/secure/eclub-bootstrap-private.sql
```

只读环境变量、在本机派生scrypt哈希，输出完整用户/权限/角色/系统记录SQL；不连接数据库。文件权限0600，拒绝覆盖已有文件，不包含明文密码，但含敏感哈希及个人信息，**不要提交Git、上传公开函数或发送给不可信Agent**。将整份文件作为一个事务在经核实支持事务的授权SQL Editor执行；不要拆开执行。共享事务锁和system/control guard保证已有初始化时整批回滚，不重建、不覆盖用户。该方案已在本地真实PG验证，未在目标CloudBase Editor验证；若Editor不支持原子事务，停止，不得采用分条写入。

## API/Cookie验收

1. 浏览器或授权终端GET现有默认域名的/api/health应200，me无Cookie应401。
2. 私有diagnose成功后才测试管理员登录。仅在受保护终端把JSON请求体写入权限0600的临时文件，使用curl `--data-binary @文件`、`--cookie-jar 私有文件`，加Origin:https://eclub.gut9.cn、Content-Type:application/json、X-Requested-With:ElectronicClub。不要把真实密码写进命令行、截图或终端历史。
3. Cookie jar保存后GET me应200且角色含超级管理员，测试创建/编辑/角色功能及错误权限403；改密/撤销后旧Cookie应401。结束后删除私有请求文件和cookie jar。
4. curl能携带Cookie不代表跨站浏览器可以。检查Set-Cookie是否被网关透传、Secure/HttpOnly/SameSite及浏览器拒绝原因；默认域名跨站Cookie问题不能通过取消CSRF或偷换Session Token到localStorage解决。
5. 断开测试数据库（不是生产）验证受控503及可关联的安全日志，确认不泄露URL/密码。单独验证XLSX附件及Base64正文。

## 免费与上线阻断

本轮未取得官方证据确认baas_trial可提供PG TCP端点、受限SQL账号或函数到端点网络；这些能力如缺失，运行时仍受阻，即使管理API成功建表也无效。免费环境自定义域名与默认域名开发测试限制按已确认事实保守执行；没有实现EdgeOne代理规避限制。

免费且合规的选择仅能在提供方明确允许的开发/测试范围内继续联调，或使用既有、无新增费用且获授权的PG主机及正式API入口（仍须网络/TLS/许可核实）。若研究CloudBase官方HTTP数据库API替换运行时，必须先证明等价事务能力并另行批准架构变更；本任务不擅自切换、不购买服务，也不保证“免费500人正式运营”。

### 可执行的API验收工具

`verify-api.mjs` 已随ZIP提供。私有终端安全设置 VERIFY_API_BASE（现有默认网关源地址）、VERIFY_ORIGIN=https://eclub.gut9.cn，执行 `node verify-api.mjs --public-only` 仅检查健康200和匿名401。数据库诊断与初始化完成后，临时设置 VERIFY_STUDENT_ID、VERIFY_PASSWORD，执行 `node verify-api.mjs` 验证管理员登录、Cookie恢复、成员/角色权限与登出撤销；密码和Cookie只存在内存，不输出、不保存。完成后清除变量。此工具不创建账号、不修改资料；默认域名只允许少量开发测试，不自动执行长期探测。

ZIP也包含deploy-preflight.mjs。它只检查配置是否存在与保守连接预算，不连接数据库，不能替代diagnose。
