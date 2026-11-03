# 第三阶段部署：活动、报名签到、新闻与全站弹窗

## 已确认的HTTP 413与图片请求预算

生产浏览器已报告 `POST /api/events/:id/update` 返回413 Payload Too Large，且该记录SQL诊断显示主键/内容ID一致。这次失败直接由请求体过大引起，不能归因于该记录的ID错配。原图129,028字节，Base64为172,040字符，Data URL为172,063字符，尚未包含JSON正文/元数据。文件小于1MB不代表请求可被HTTP入口接受。

前端现自动压缩上传图片及编辑保存的旧内嵌封面至32KiB以内；JPEG保持JPEG，PNG/WebP优先WebP保留透明度。处理同时用于独立弹窗和发布联动弹窗。原文件仍限制1MB。所有活动/文章/弹窗写请求在序列化后按UTF-8字节检查64KiB保守客户端预算，超过时不提交并明确提示缩短正文/压缩图片；成员Excel导入不受此预算影响。64KiB为本项目的保守配置，不是已核实的腾讯云套餐限制。

本次413处理只改前端，**无需新的SQL或云函数上传**；现有云函数仍需已经具备前述更新接口。更新EdgeOne后重新选择原图或直接保存旧封面，等待图片处理完成。若实际入口仍拒绝预算内请求，需核对网关实际限制再调整，不得把本地成功等同于真实云验收。长图文及大图后续应采用授权文件上传/对象引用方案，本修复不引入付费服务或公开写存储。

## 记录ID一致性与保存状态修复

发现并在隔离数据中复现了一个独立于图片格式/HTTP方法的缺陷：数据库主键为A、JSON中的id为B时，旧编辑接口读取A，却通过 `tx.set('events', event.id, ...)` 写入B。若B是另一条已有活动，会出现“返回ID改变且图片能显示，但原活动不更新”，甚至覆盖另一记录。生产是否存在这种数据不一致仍需只读查询确认，不能将本地复现等同于生产根因确诊。

新代码对活动/文章的列表、详情和业务操作统一以实际查询主键为准；保存只更新该主键，并在此次写入时将该行JSON中的id校正为同一值，保留原报名/签到/负责人关联。不会批量迁移、删除其他行或自动合并重复活动。前端拒绝编辑响应偷偷切换ID。异常读取日志为 `CONTENT_ID_MISMATCH`，不记录图片、密码、Cookie或成员信息。

另修正前端保存结果判断：共享busy状态使保存未执行时，不再根据空提示显示“已保存”；保存后刷新列表失败也不会被成功文案覆盖。

需先上传新版ZIP，再更新前端，不需要DDL迁移。可先在现有SQL编辑器运行 [只读诊断SQL](../cloudbase/sql/diagnose-content-identity.sql)，只返回主键/id一致性、封面字符数、更新时间和目录引用，不改变任何数据。若存在目录缺失或两条真实重复活动，需单独审查，不应自动删除以免丢报名记录。

## 封面编辑兼容修复

前端修改活动/文章改用 `POST /api/events/:id/update`、`POST /api/articles/:id/update`；后端仍保留原 PATCH 接口。新接口进入相同的鉴权、权限、参数验证和数据库事务，更新原记录，保留报名、签到和原活动地址。这样编辑与新建均通过 POST 传输 JSON，避免依赖网关的 PATCH 请求体透传。它是针对线上“新建能显示，编辑不生效”现象的兼容处理，不代表已经确认腾讯云网关是根因。

本修复包含后端代码：**先上传本目录所对应的新 ZIP，再更新 EdgeOne 前端**。入口仍为 `index.main`，运行时仍兼容 Node18.15；不需要新增 SQL、重建活动、重置账号或调整数据库权限。前端仅在保存后的服务器回读与所选封面一致时提示成功。仍需在真实 CloudBase 上以原活动验证封面及报名关系。

## 发布状态与边界

开发分支：`feat/stage3-events-content`。本阶段保留已正常登录的成员系统、Cookie会话、8位密码规则、动态RBAC、Excel导入和健康接口。用户已完成第二阶段管理员真实登录；本轮没有连接生产数据库、上传腾讯云函数、重建账号或执行DNS操作。

**新增迁移尚未在现有生产库验证，按任务要求保留功能分支，不自动合并main或触发正式前端部署。** 本地真实PG/浏览器验证不等同CloudBase上线验收。当前默认API域名仍限开发测试；原跨站Cookie/免费套餐正式域名限制并未被第三阶段代码解决。

## 1. 数据架构

当前工程使用原生PostgreSQL JSONB表，经既有PostgREST HTTPS RPC访问；没有调用pgdoc集合API。第三阶段延续Store/Transaction和service_role，不新建数据库角色、认证身份或数据库，不修改pgdoc供应商schema。

新增七张私有表：events、event_managers、registrations、checkins、articles、popup_announcements、popup_state，全部位于electronicclub。注册和签到的(event_id,member_uid)有数据库唯一索引和外键，主键使用活动UUID与真实成员UID的规范组合。events.occupied有非负和不超capacity的CHECK。待审核报名也占名额，取消和拒绝释放；管理员明确为未报名者补签记录为manual，不占普通报名名额。

事务使用原有pg_advisory_xact_lock(1991,1)。HTTP适配器收集读版本后一次ec_commit完成所有写入，冲突退避重试上限32次，绝不跨HTTP请求假设BEGIN/COMMIT共享连接。新增业务不回退内存。RPC读写集上限20000；大规模名单和真实云性能尚未压测，不能据此承诺500人正式运营稳定性。

popup_state只有主键current一个有效槽位，popup_announcements.active_slot有延迟唯一约束。后台根据UTC窗口和已发布关联内容原子选择：优先级大者优先，其次生效时间、创建时间、ID倒序。立即启用新公告会退役之前已经到期生效的旧版本；未来公告只排期，不提前替换。定时竞争中未激活的低优先级候选可等待；已被替换的active记录不自动复活。激活在后台读/管理请求事务中完成，无需付费定时服务，也不由前端扫描选择。弹窗图片和版本由后端返回唯一当前项。

## 2. SQL执行顺序（当前已有第二阶段环境）

1. 备份electronicclub schema，特别是users、credentials、sessions、roles、permissions、system以及已有业务数据。只由有权限的管理者操作，不把备份/密码上传GitHub。
2. 在测试数据库或测试环境，以与生产相同权限的SQL账号验证迁移；本地测试已覆盖无CREATEROLE账号，但不能替代生产schema兼容检查。
3. CloudBase控制台 → 环境`natural-tuna-d6gptlw1w76fa8a63` → PostgreSQL → SQL编辑器。先执行`cloudbase/sql/editor-login-check.sql`，确认已有成员表和ec_* RPC存在。**已初始化管理员不要再运行bootstrap。**
4. 打开功能分支中的 **cloudbase/sql/008-stage3.sql**，复制完整文件执行。保留BEGIN/COMMIT和全部DO/函数块，不按分号拆分。它创建新表、索引、唯一/FK/CHECK约束，扩展本应用ec_table白名单与RPC事务上限，给现有service_role授权，并插入12项新权限定义。不修改现有成员、密码、会话或角色授权记录；没有DROP/TRUNCATE、CREATE ROLE或pgdoc集合操作。
5. SQL失败时停止，记录第一条错误。若提示事务已中止，先按编辑器实际会话状态ROLLBACK，不删除或强行重建已有表。重复执行008使用IF NOT EXISTS/版本记录，已有同名不兼容表会报错而不是覆盖。
6. 新安装环境才按“基础editor-https-install.sql → 008-stage3.sql → 私有管理员初始化”执行。已经升级阶段3后，不要单独重跑旧基础安装脚本覆盖扩展的ec_table；若执行过基础脚本，需要再次执行008恢复扩展。

迁移后只读核对（不输出个人信息）：

```sql
SELECT version FROM electronicclub.schema_migrations WHERE version='008-stage3';
SELECT table_name FROM information_schema.tables
WHERE table_schema='electronicclub'
AND table_name IN ('events','event_managers','registrations','checkins','articles','popup_announcements','popup_state')
ORDER BY table_name;
SELECT id FROM electronicclub.permissions
WHERE id LIKE 'events.%' OR id LIKE 'articles.%' OR id='announcements.popup.manage';
```

不要直接以SQL编辑器的管理身份调用ec_read作为运行身份验收；RPC只接受service_role，管理账号不会被当成浏览器服务端身份。

## 3. 云函数ZIP上传

下载本分支`deployment-packages/electronicclub-api.zip`，对应校验文件为`electronicclub-api.zip.sha256`。仓库同时生成`artifacts/electronicclub-api.zip`。GitHub文件页点击Download raw file；不要上传整个仓库ZIP，不需要自己重新压缩。

在当前CloudBase环境 → 云函数 → **electronicclub-api** → 代码部署 → 本地ZIP上传，上传完整包并保存部署。不要依赖在线Cloud Studio工作区或CloudBase Agent运行终端。

- 入口：**index.main**。
- 现有运行时：**Node.js18.15**；构建目标node18，包内依赖齐全，不需要云端npm install。平台有维护中的Node22时可另行升级验收，Node18上游已结束维护。
- ZIP根目录含index.js、package.json、package-lock.json、node_modules、bootstrap.js、offline-bootstrap.js、diagnose.js、maintenance.js、sql/等；没有apps/functions/deploy外层目录。
- 实际体积和SHA256见同目录README/校验文件。无新增运行依赖，大小与第二阶段已上传包同量级；当前套餐上传限制仍以控制台为准，本轮未实际上传验证。
- 建议函数超时至少60秒，内存保持当前已能运行的256MB起步。真实容量和导出性能应在套餐允许范围内测试，不自动购买资源。
- 部署前保留旧函数版本/ZIP和环境配置，以便回滚。

## 4. 环境变量与网关

继承现有已登录成功的配置，不重置管理员密码：

```text
DB_DRIVER=cloudbase-http
CLOUDBASE_ENV_ID=natural-tuna-d6gptlw1w76fa8a63
ALLOWED_ORIGIN=https://eclub.gut9.cn
COOKIE_SECURE=true
```

如果现有开发联调使用COOKIE_SAMESITE=none，继续保留；None仍要求Secure及精确HTTPS Origin，浏览器可能禁止第三方Cookie。默认Lax仅适合同站点调用。默认复用SCF平台临时执行身份，不增加CLOUDBASE_APIKEY必填项，不将长期腾讯云根密钥加入函数，不重新配置BOOTSTRAP_PASSWORD。Node18包内私有维护命令如需执行，必须在有合法临时身份的私有终端运行。

保留现有默认网关及`/api`前缀路由，**无需新增域名或单独注册每个业务路径**。确认/api下所有子路径透传，GET/POST/PATCH/DELETE/OPTIONS及现有PUT可用，Set-Cookie、Content-Type、Content-Disposition、statusCode、isBase64Encoded按现有集成处理。导出返回XLSX二进制附件，而非Base64文本。健康200和匿名me401不代表业务数据库验收通过。

## 5. EdgeOne前端

先验证SQL，再更新函数，最后从本功能分支做预览构建，避免旧后端承接新页面。生产main保持原状，待真实兼容验收通过后再合并和发布。

```text
安装命令 npm ci
构建命令 npm run build -w @electronic-club/web
输出目录 apps/web/dist
构建Node 22
```

预览建议使用独立且套餐允许的测试数据库/函数，ALLOWED_ORIGIN填预览站点实际HTTPS源地址，VITE_API_BASE_URL指向该测试API。不应为了预览更换正在使用的生产ALLOWED_ORIGIN而中断原站登录。若没有免费测试云资源，先用本地真实PG与生产只读schema审查，不自动购买或新增服务。

正式协调发布时，VITE_API_BASE_URL沿用对应API源地址，不加/api；该变量只放公开地址，不放凭据。修改分支或变量后必须重新构建。现有edgeone.json已经覆盖/news/*、/activities/*、/admin/*的SPA fallback，新页面无需额外DNS或rewrite配置。网站继续原蓝白样式、Logo及真实社团介绍；初始没有新闻/活动/弹窗数据，不插入示例内容。

## 6. 权限配置与活动负责人

新权限：events.create、events.edit、events.delete、events.registrations.read、events.registrations.review、events.registrations.export、events.checkin.manage、articles.create、articles.edit、articles.publish、articles.delete、announcements.popup.manage。

SQL仅增加权限定义，不给旧角色自动增加授权。现有超级管理员仍可通过既有super标志管理；更新后端后进入原角色权限界面授予其他角色所需权限，不按会长/副会长等固定职位判断。原activities.* / articles.manage / popups.manage占位定义保留兼容，不自动换成新授权。

活动创建者默认成为该活动负责人；具有events.edit的操作者可按学号查询必要标识并分配负责人。负责人可编辑、查看/审核/导出名单和管理签到，但只能作用于获授权活动；不会获得全站成员管理或弹窗权限。删除活动仍需events.delete。独立文章发布/撤回按钮只需articles.publish，修改正文需要articles.edit，发布已编辑内容还会检查发布权限。创建文章权限不会自动带来发布权限。

## 7. 新增API清单

全部路径在既有/api下。受保护接口复用HttpOnly会话、账号状态/首次改密检查；写请求沿用Origin + X-Requested-With + JSON CSRF保护。

| 方法和路径 | 用途 / 权限 |
|---|---|
| GET /api/public/events | 已发布活动分页、标题搜索 |
| GET /api/public/events/:id | 已发布活动详情，无名单/负责人内部数组 |
| GET /api/public/articles | 已发布文章分页、分类/标题筛选、置顶优先 |
| GET /api/public/articles/:id | 已发布文章详情 |
| GET /api/public/popup | 后端原子返回唯一当前弹窗或null |
| GET /api/events | 当前可管理活动列表，普通成员仅已授权活动 |
| POST /api/events | 创建活动，events.create |
| GET /api/events/:id | 管理详情，负责人或相关全局活动权限 |
| PATCH /api/events/:id | 编辑活动，events.edit或该活动负责人；分配负责人另查events.edit |
| POST /api/events/:id/update | 兼容网关的编辑入口，权限与PATCH相同，保留活动ID及报名签到 |
| DELETE /api/events/:id | 软删除，events.delete |
| GET /api/events/manager-lookup?studentId= | 分配负责人所需UID/昵称，events.edit；不返回完整档案 |
| GET /api/events/:id/member-lookup?studentId= | 明确补签所需成员标识，活动签到管理范围 |
| GET /api/events/:id/registration | 当前成员自己的报名记录 |
| POST /api/events/:id/registration | 登录成员报名，body仅note；身份快照从服务端档案读取 |
| DELETE /api/events/:id/registration | 截止前按活动规则取消；已签到不可取消 |
| GET /api/events/:id/registrations | 名单分页/搜索/学院/班级/状态/签到过滤，read或负责人 |
| GET /api/events/:id/registrations/export.xlsx | 全部或筛选结果XLSX，export或负责人，写审计 |
| POST /api/events/:id/review | uid + approved/rejected，review或负责人 |
| POST /api/events/:id/checkin-code | open + ttlSeconds(30–600)，checkin.manage或负责人 |
| POST /api/events/:id/checkin | 登录成员凭code签到；需已通过报名且活动开放、码未过期 |
| POST /api/events/:id/manual-checkin | uid + 必填reason，授权补签；可明确为未报名成员补签 |
| GET /api/articles | 管理文章分页/搜索/状态/分类，按文章权限范围 |
| POST /api/articles | 创建草稿或文章，create；直接发布另查publish |
| GET /api/articles/:id | 管理详情，编辑/发布/删除权限或创建者读取自己的草稿 |
| PATCH /api/articles/:id | 部分更新，articles.edit；已发布内容另查publish |
| POST /api/articles/:id/update | 兼容网关的文章编辑入口，权限与PATCH相同 |
| POST /api/articles/:id/publish | publish布尔值，独立发布/撤回，articles.publish |
| DELETE /api/articles/:id | 软删除，articles.delete |
| GET /api/popups | 当前、待生效、历史和停用记录，announcements.popup.manage |
| POST /api/popups | 发布新版本，独立弹窗权限；必须关联已发布活动/文章 |
| PATCH /api/popups/:id | enabled布尔值，启用新版本或停用；过期版本需重新发布 |

列表page从1起，pageSize默认20、最大100；名单支持search、college、className、status、checkedIn=yes/no。导出应用过滤条件但忽略当前页，输出全部匹配记录，列为序号、学号、姓名、性别、学院、专业、班级、年级、备注、报名时间、报名状态、签到状态。学号与备注使用文本单元格，字母/前导零保留，公式样式备注不会成为公式。响应文件名含活动名称与北京时间日期，没有公开永久下载地址。

## 8. 内容与图片安全

正文使用安全Markdown子集：标题、列表和普通段落，Vue文本节点渲染，不使用v-html。原始HTML、脚本和事件属性按文字显示。封面通过原生文件输入上传PNG/JPEG/WebP，前端1MB限制，后端Base64/长度约束；图像持久化于现有PG字段，或使用HTTPS图片地址，不新增付费存储服务。外部图片可达性和真实云大图性能尚未验证。

弹窗目标只能是服务器认可的已发布活动/文章ID，按钮不能跳到任意外站脚本。浏览器sessionStorage记录已展示版本，同一会话同一版本最多一次；新版本可再次显示。首页首次进入时展示，路由切换不重复；Escape、关闭按钮及键盘焦点限制可用。存储被禁用时跳过弹窗以避免反复弹出。

报名快照是历史资料，成员后续改学院/姓名不会改动既有快照。原私有maintenance.js隐私清理流程已扩展为清除该成员报名快照、备注、签到原因及发布者显示名，保留匿名UID关联和必要审计。需要在有合法权限的私有终端运行原隐私任务；不能把备份或已下载名单当成自动清理范围。

## 9. 实际验收步骤

1. 保留现有管理员，GET /api/health应200，匿名GET /api/events应401，已登录me仍200。未授权成员不能发布文章、访问别的活动名单或全站成员列表。
2. 超级管理员创建草稿活动，再发布；核对发布时间为服务器当前时间，活动开始为单独设置的未来时间。未开启报名时前台不出现报名表。
3. 开启报名，设置截止/人数/备注规则。成员报名后在后台确认身份快照与绑定档案一致；前端伪造姓名或UID应被拒绝。关报名、停用活动、过截止、满额应拒绝。
4. 设置审核并测试批准/拒绝和取消；待审核占名额。15人抢最后一个名额的自动测试已在真实本地PG通过，目标云仍需测试账号在测试活动验收，不使用真实成员做压力测试。
5. 为普通成员指定一个活动负责人，验证只管理这一活动，可查/审/导出/签到，不能查看其他活动或全站成员资料。分配负责人和补签界面可按学号操作，不要求普通成员提供数据库凭据。
6. 下载名单核对中文列序、字母学号和前导零、备注等号为文本、筛选范围及签到状态；确认HTTP网关正确解码附件与文件名，审计有导出记录。
7. 开启签到，复制2分钟有效码，成员签到一次/再次签到均不新增重复记录；过期码拒绝，未通过报名不可自助签到。管理员补签须填原因，未报名补签标记manual且不占普通名额。
8. 发布新闻，测试分类/置顶、草稿隐藏、撤回和删除。标题/正文输入HTML测试时应显示文字，不执行脚本；只能在测试内容中验收，不虚构正式新闻。
9. 独立弹窗管理员创建立即版本，确认替代旧版；创建未来版本不提前替代，按优先级在服务器选择唯一版本。关闭后同一浏览器会话不再显示同版本，发布新版本可显示。
10. 再回归成员列表、Excel导入、角色配置、密码修改/重置、登出撤销和账号禁用。真实云上的新增接口、上传图片、跨站浏览器、附件及大规模性能本轮均尚未验收。

## 10. 回滚

推荐代码回滚，保留数据：恢复部署前的函数ZIP、环境配置和EdgeOne构建版本。恢复前后端同一兼容版本，不更换管理员，不再运行bootstrap。008新增表、权限定义和扩展RPC可以保留；旧成员功能仍使用原表和同一事务接口。若回滚了旧RPC定义，未来恢复阶段3前再执行008。

迁移本身在一个事务内；失败由数据库回滚，不要把前面的成功语句当成整份完成。脚本可重试。**没有提供DROP/TRUNCATE式自动降级**，避免删除报名、签到、新闻和审计。若必须清理业务数据，另行审查备份与明确授权；本交付不执行破坏性删除。阶段3新授权由管理员明确配置，回滚角色授权也应逐个审查，不覆盖整个roles表。

## 11. 自动化结果及安全告警

要求的npm ci、npm run check、npm audit --omit=dev均已执行；代码检查/类型/测试/前后端生产构建通过。最终自动化测试为40项全部通过，ZIP校验见部署包目录记录。测试包含原第二阶段回归、第三阶段全业务，以及真实本地PG由NOCREATEROLE账号连续执行008两次、成员/角色/凭据迁移前后字节等值、SQL唯一约束、15人并发、回滚、匿名隔离和RPC路径。

浏览器连接隔离本地真实PG，在375/430/1440/1920检查页面无横向溢出，验证真实登录、报名签到、名单下载、发布表单、联动弹窗、同版本不重复及HTML不执行。测试数据未进入ZIP或生产库。

生产依赖审计：10项moderate，0 high/critical；npm audit因现有moderate告警返回非零，不是零风险。主要为Excel/ZIP依赖链中的archiver、glob、minimatch、uuid、yauzl等，未新增第三阶段运行依赖。原2MB XLSX输入、20MB解压/2000条目限制、拒绝公式输入、文本导出、服务端权限与CSRF仍保留。Node18运行时已上游EOL，正式上线仍需平台维护版本和域名条件验收。

当前结论：代码可进入预览与受控云端验收；**不能宣称第三阶段已上线或直接安全正式发布**。生产迁移兼容/套餐配额/实际HTTP附件/大图/跨站Cookie及新业务均需操作人按上述流程验证。
