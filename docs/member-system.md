> **运行时更新：默认改为PostgreSQL HTTPS RPC，不再必须提供TCP地址。请先阅读 [最新HTTPS操作步骤](cloudbase-https-runtime.md)。以下TCP配置仅适用于显式 DB_DRIVER=postgres-tcp。**

# 第二阶段：成员与动态权限

当前为可运行实现，自动化测试使用显式内存适配器；尚未在真实腾讯云环境部署或验证。生产默认只使用 CloudBase 文档数据库，配置或网络失败不会回退到内存，也不会自动生成管理员。

## 认证方式核查与选择

本轮核查官方 npm 发布源码及类型：

- `@cloudbase/js-sdk@3.10.4` 的 `core.d.ts` 提供 `auth.signInWithPassword({ username, password })`。用户名可承载学号字符串；原生用户名登录是存在的。
- `@cloudbase/manager-node@5.9.4` 的 `types/user/index.d.ts` / `lib/user/index.js` 提供 `user.createUser({ name, uid, password, ... })`，可逐个管理员创建，不需要虚构“批量创建”接口。新版实现明确校验密码 8–32 位、字母数字开头且至少三类字符；`123456` 不满足。旧 `createEndUser` 接口仍存在，但不能据此保证新版环境接受弱密码。
- 官方依据：[Web v3 认证](https://docs.cloudbase.net/api-reference/webv3/authentication)、[管理 SDK](https://github.com/TencentCloudBase/cloudbase-manager-node)、[服务端 SDK](https://github.com/TencentCloudBase/node-sdk)。核查依据是下载的当前 SDK 源码，不等同于目标租户的线上 API 调用成功。

本实现保留指定的六位初始激活密码，选择**应用层认证，托管于 CloudBase 云函数和文档数据库**，不是 CloudBase 原生认证账号。学号经 SHA-256 确定唯一映射文档，指向随机 UID；`users._id = uid` 是本系统身份，不冒充原生 Auth UID。密码只在服务端通过 scrypt 验证（独立随机盐，N=16384/r=8/p=1/64字节输出），哈希保存在独立私有 `credentials` 集合。前端从不校验密码，也不能直接操作数据库。

此模式不需要开启 CloudBase 原生用户名注册、匿名登录或客户端数据库访问。若今后取消 `123456` 要求，可以另行迁移原生 Auth；不能混用原生 token 与当前会话，也不能把两套 UID 当作同一个身份。

## 会话与域名配置

1. 云函数使用 Node.js 22.12+，运行环境具有 CloudBase 数据库的服务端身份。
2. 设置 `CLOUDBASE_ENV_ID` 为真实环境 ID，`ALLOWED_ORIGIN` 为前端的**精确 HTTPS Origin**，不带尾部 `/`。SDK 使用云函数运行身份；本地初始化时通过安全环境配置注入 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY` 和可选 `TENCENTCLOUD_SESSIONTOKEN`（使用官方SDK读取），勿把密钥放入仓库、Vite 或聊天。
3. 前端构建变量 `VITE_API_BASE_URL` 设置为后端服务源地址；允许凭据的 CORS 响应只回显 `ALLOWED_ORIGIN`，不使用 `*`。
4. 生产请使用同站点自定义域名，例如前端 `https://club.example.edu`、后端 `https://api.example.edu`。默认 EdgeOne 与 CloudBase 的不同站点域名不满足 SameSite=Lax 会话设计。也可以配置可信的同源 `/api` 反向代理。不能只设置 CORS 就认为跨站 Cookie 一定可用。
5. 会话为 256 位随机 opaque token，仅通过 `__Host-ec-session` Cookie 下发：Secure、HttpOnly、SameSite=Lax、Path=/，不设 Domain。数据库只保存 token 的 SHA-256。前端无 localStorage/sessionStorage token。
6. 普通会话绝对有效期8小时、空闲30分钟；未改密会话15分钟。每次保护请求核对账号状态、撤销版本、强制改密及数据库角色权限；改角色、重置密码、禁用、删除、修改密码和撤销所有会话使相应旧会话失效。
7. 改密前仅允许身份恢复、改密和登出；初始激活凭据7天后失效。新密码至少8位且包含字母和数字。初始密码是公开约定，导入后应通过受控渠道通知并核实实际成员，不能把该密码当作长期身份凭据。
8. 写操作要求精确 Origin、`X-Requested-With: ElectronicClub` 和 JSON Content-Type，防止跨站表单提交。后端还独立执行全部鉴权与参数校验。
9. 学号维度15分钟最多10次失败；成功后重置该学号失败计数。网关可信 IP 维度15分钟最多200次登录尝试；缺少可信 IP 时统一使用保守公共桶。不要将客户端可伪造的 X-Forwarded-For 直接当作可信 IP；应核对 HTTP 网关是否提供 `requestContext.sourceIp`，否则在网关增加源 IP 限流。

## 数据库集合、索引与权限

索引清单见 `cloudbase/indexes.json`，客户端规则模板见 `cloudbase/database.rules.json`。

| 集合 | 主键 / 内容 | 关键索引 |
| --- | --- | --- |
| users | UID，成员档案、账号状态、撤销版本 | status + createdAt + _id；学院/班级/roleIds筛选的组合索引 |
| student_ids | SHA-256(normalizeStudentId(studentId)) → UID | `_id` 唯一；事务保证学号全局唯一，包括软删除成员 |
| credentials | UID → scrypt哈希 | `_id` 唯一；仅服务端 |
| sessions | SHA-256(token) → UID、版本、绝对与空闲失效时间 | UID、expiresAt，过期文档可定期清理 |
| roles | 角色ID、名称、描述、permissionIds、引用人数 | createdAt + _id |
| permissions | 权限ID、分组、是否已实现 | createdAt + _id |
| audit_logs | 操作者UID、操作、目标UID、变更字段名称、时间 | createdAt + _id；actor + createdAt |
| import_jobs | 文件哈希、拥有者、解析行、进度与结果 | createdAt + _id；owner + createdAt |
| login_limits | 哈希键、窗口计数和到期时间 | until |
| system | 单条 control，初始化标记、活跃超级管理员数量与安全事务版本 | `_id` 唯一 |
| privacy_jobs | 匿名化任务、原学号摘要及清理状态 | status + createdAt |

所有上述集合均设置浏览器 `read:false, write:false`。规则文件为逐集合控制台配置模板，不声称 CLI 会自动应用。服务端 SDK 使用运行身份访问，不依赖浏览器数据库权限。不要配置所有人可读；`credentials`、`sessions`、导入任务和审计尤其不能对浏览器开放。

`CloudStore` 使用当前 `@cloudbase/database@1.4.3` 的真实 `startTransaction()`、`transaction.get(ref).data()`、`set(ref,data)`、`delete(ref)`、commit/rollback；没有使用旧类型文件里过时的 transaction.collection API。业务异常回滚、不自动重试；明确的事务冲突最多重试两次。

安全变更共同读写 `system/control`，保证最后超级管理员保护、角色引用计数、学号唯一性、导入进度不会发生写偏差。该方案优先保证中小型社团正确性，是一个写入热点；高并发场景须测量事务冲突并评估分片方案，不可直接移除控制文档。列表使用数据库过滤、分页和确定性排序；关键词查询为转义后的字面量匹配。

### 初始化顺序

```bash
npm ci
npm run check
# 在已注入真实服务端身份的受控终端执行；设置 CLOUDBASE_ENV_ID
npm run bootstrap -w @electronic-club/functions -- --collections
```

`--collections` 用于全新环境创建上述集合；已有集合时请在控制台补齐缺失项，不要删除现有数据重跑。然后在 CloudBase 控制台配置每个集合的拒绝客户端访问规则，按索引清单创建索引并等待完成。索引文件是清单，不会由构建自动部署。真实环境是否支持全部筛选组合和排序，须用真实数据测试；根据缺失索引提示补齐。

### 安全创建首个超级管理员

在受保护终端通过安全环境变量传入 `BOOTSTRAP_STUDENT_ID`、`BOOTSTRAP_NAME`、`BOOTSTRAP_PASSWORD`，可选 `BOOTSTRAP_NICKNAME` 设置昵称。学号支持字母数字并统一转为大写。密码由部署者自行生成，至少8位且包含字母数字；没有公开固定学号或默认管理员密码。不要将密码放入命令参数、脚本或提交文件；终端可用 `read -rs` 读取再 export。

```bash
npm run bootstrap -w @electronic-club/functions -- --initialize
# 完成后清除 BOOTSTRAP_PASSWORD 等初始化变量
```

该脚本直接操作数据库，不是 HTTP 初始化接口；HTTP 打包只导出 `index.main`。首次初始化在单个事务中建立权限、七个初始角色、超级管理员及审计记录。`system/control` 存在即拒绝第二次初始化，不能通过普通角色API创建“超级管理员标记”。初始化失败不能通过删除 control 来“修复”，应先调查数据库事务和凭据。

初始管理员角色拥有本阶段已实现的成员/角色/审计权限；社团职位角色初始不附带系统管理权限，授权后动态生效。职务单独存储在 `position`。普通管理员仅能管理权限不高于自己的成员/角色，不能授予自己不具有的权限。超级管理员角色受保护，最后一名活跃超级管理员不能删除、禁用或降级。

## HTTP API

除健康检查与登录外都必须使用会话；写操作还需上述 CSRF 头。返回统一 `{success,data}` 或 `{success:false,error:{code,message}}`。XLSX 下载返回二进制响应。

| 方法和路径 | 功能 / 服务端权限 |
| --- | --- |
| GET /api/health | 原健康接口，独立于数据库配置 |
| POST /api/auth/login | `{studentId,password}`，限流、创建会话 |
| GET /api/auth/me | 恢复当前身份、档案及权限 |
| POST /api/auth/logout | 撤销当前会话、清 Cookie |
| POST /api/auth/password | `{oldPassword,newPassword}`，强制改密、撤销全部旧会话 |
| POST /api/auth/revoke-sessions | 当前用户撤销所有会话 |
| PATCH /api/profile | 仅 nickname/gender/phone/email/avatar；未知字段拒绝 |
| GET /api/members | members.read；page/pageSize/search/college/className/roleId/status |
| POST /api/members | members.create；默认普通成员、初始激活密码和强制改密 |
| GET /api/members/:uid | members.read |
| PATCH /api/members/:uid | members.edit；身份资料更正并审计；改学号撤销旧会话 |
| PUT /api/members/:uid/roles | roles.assign；多角色、授予范围与最后管理员保护 |
| POST /api/members/:uid/password | members.password；重置初始激活密码、撤销旧会话 |
| PATCH /api/members/:uid/status | members.status；active/disabled |
| DELETE /api/members/:uid | members.delete；软删除，保留学号预约 |
| POST /api/members/:uid/restore | members.delete；恢复为禁用状态，另行启用 |
| POST /api/members/:uid/anonymize | 仅超级管理员；仅软删除账号，不可逆匿名化 |
| GET /api/members/export?page=N | members.export + members.read；每批100条JSON |
| GET /api/members/export.xlsx?page=N | 同上；每批100条XLSX，学号文本 |
| GET /api/roles?page=N | roles.read；每页100个 |
| POST /api/roles | roles.manage；创建自定义角色 |
| PUT /api/roles/:id | roles.manage；修改名称、描述、权限集合 |
| DELETE /api/roles/:id | roles.manage；仅未使用的非初始角色 |
| GET /api/permissions | roles.read；含本阶段实现及未来预留权限定义 |
| GET /api/imports/template | members.import；下载空白XLSX模板 |
| POST /api/imports/preview | members.import；`{file:base64}`，解析/验证/持久化任务 |
| GET /api/imports/:hash | members.import；仅任务拥有者或超级管理员 |
| POST /api/imports/:hash/process | 同上；`{offset}`，每批20行；进度不符幂等返回当前状态 |
| GET /api/imports/:hash/errors.xlsx | 同上；导出错误行和原始行号 |
| GET /api/audit?page=N | audit.read；每页50条 |

登录失败401、会话失效401、强制改密/权限不足403、记录不存在404、重复学号/最后管理员保护409、超限429、未配置数据库或初始化503。日志不保存密码、Cookie或身份资料旧值；记录操作者、目标和变更字段名。

## Excel 行为

仅接受 `.xlsx`；服务端检查 ZIP 容器，压缩文件≤2MB，解压声明总量≤20MB、条目≤2000；最多1000行/文件，较大名单分文件处理。表头严格匹配学号、姓名、性别、学院、专业、班级、年级；学号必须为英文字母或数字文本（4–24字符），统一转换为大写，不允许空格或特殊字符。数字、科学计数和公式学号直接报错，绝不猜测恢复。模板学号列设置文本格式，数据库学号保持字符串。

预览展示字段错误、文件内重复、已有学号；提交时在事务中再次检查唯一性。文件内容哈希确定任务ID，同一文件不会创建第二个任务；重复批次 offset 不会重复创建账号。失败事务不会推进进度。中断后输入任务ID可继续。错误行跳过并导出，格式错误的学号不写入“猜测值”；根据原始行号在源文件中修正。任务拥有者权限被撤销后不能继续导入。

## 软删除、匿名化和保留策略

默认软删除可恢复，恢复后为禁用状态，学号仍预约。匿名化只允许超级管理员对软删除账号操作：清空 users 中身份字段、角色和凭据，撤销旧会话并释放学号预约；保留最小UID墓碑及审计关联，不提供不受控的硬删除 HTTP 接口。

匿名化事务同时创建私有 `privacy_jobs`，因为历史导入任务也可能含个人信息，部署运维必须随后执行：

```bash
npm run privacy -w @electronic-club/functions -- <已匿名化UID>
```

该幂等私有脚本扫描历史导入任务，清除匹配UID或学号摘要的行资料，再将任务标为完成。**只调用匿名化 API 不代表所有历史数据已清除**，应检查该任务完成。导出到外部的文件和数据库备份须按学校政策另行销毁或到期清理。建议导入记录保留30天、审计保留180天；部署者需设置受保护的定期清理任务或控制台流程，此版本没有虚构已生效的 TTL。未自动清理的过期会话虽不能认证，仍需运维清除过期文档。

## 本地联调与测试

生产默认 CloudStore。没有凭据时可**显式**使用内存适配器，仅限 `src/local.ts`：

```bash
# 用安全环境变量设置 LOCAL_ADMIN_STUDENT_ID、LOCAL_ADMIN_PASSWORD；自行选择本地测试账号
MEMBER_STORE=memory COOKIE_SECURE=false ALLOWED_ORIGIN=http://localhost:5173 npm run dev:api
# 另一个终端
npm run dev
```

内存模式每次进程/热重载会清空账号，不是持久化生产数据库。普通业务不会自动加载 Mock 档案；登录后用户中心展示该适配器或真实数据库实际返回的账号。`COOKIE_SECURE=false` 仅适用于本地HTTP，生产必须省略它。前端和 ALLOWED_ORIGIN 端口须一致。

`npm run check` 包含登录、错误密码、未认证、强制改密、不可修改身份、重复学号、前导零、重复文件与并发提交、重置与禁用、权限并集、越权分配、最后管理员并发保护、审计和会话失效等自动化测试。测试通过仅证明测试适配器下的行为，不证明真实 CloudBase 事务、索引、网关 Cookie 或腾讯云部署成功。

## 部署产物与真实验收

`npm run build` 生成 `apps/functions/deploy/index.js` 和独立 `package.json` / `package-lock.json`；上传 deploy 目录内容，入口 `index.main`，在云端安装运行依赖。不要继续只上传旧的 dist：本阶段需要真实SDK及Excel解析依赖。根目录锁文件用于 Monorepo；部署目录使用 `npm ci --omit=dev` 安装已锁定的运行依赖。当前没有上传或运行腾讯云部署。

EdgeOne 保持根目录构建、`npm ci`、前端构建命令与 `apps/web/dist`，新增 `/account`、`/change-password` 和 `/admin/*` SPA 回退。确认平台读取根 `edgeone.json`。真实验收必须包括：初始化仅执行一次、关闭客户端数据库权限、同站点HTTPS Cookie、重登恢复、角色变更立即生效、重复批次无重复账号、并发最后管理员保护、实际查询索引、真实XLSX下载，以及备份/隐私清理流程。

## 依赖审计限制

新增直接校验依赖采用 Zod 4.6.7，并覆盖 SDK 的 Axios 为兼容的0.34.0；根和云函数运行锁文件均包含该覆盖。实际 `npm ci` 已验证安装该版本，部分 npm workspace 的 `npm ls` 仍会因上游声明固定0.27.2而标 invalid，这不等同于实际安装回退。

当前 `npm audit --omit=dev` 仍报告14项（3 high、11 moderate、0 critical），其中高风险根源是 CloudBase 数据库依赖的 `lodash.set`，SDK与数据库包各有连带告警。没有通过强制降级 SDK 或关闭校验来掩盖它；应用限制所有字段和数据库路径，禁止用户传入任意更新路径，但不能据此宣称上游风险已消除。真实上线前需对上游修复/受控补丁进行审核和验证。此审计不是 `npm run check` 的通过项。

修改运行依赖后：更新 `scripts/build-functions.mjs` 的清单，重新生成 deploy 清单与锁文件并同步 `cloudbase/runtime-package-lock.json`；打包会拒绝不匹配的依赖清单。

## 本次验证记录

最终 `npm run check`：19项测试通过，无跳过；类型、lint与生产构建通过。浏览器使用显式内存适配器走通创建成员、编辑角色、导入、强制改密、登录恢复和越权路由拦截，并检查1440/1920/375/430px。另在仓库外独立安装云函数部署依赖并执行打包健康入口通过。以上均不是腾讯云线上验证。

## 学号规范化修复

最新修复已通过27项自动化测试及生产构建。规则、数字账号兼容性、bootstrap昵称配置及不会覆盖原账号的迁移方案见 [student-id-migration.md](student-id-migration.md)。本次没有读取或迁移生产数据。
