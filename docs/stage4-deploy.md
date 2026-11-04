# 第四阶段：电子社区部署、接口与验收

本阶段从 main `b71f941` 延续现有 Vue/TypeScript、成员会话、scrypt、动态角色、CloudBase PostgreSQL HTTPS RPC。无第二套认证，无文档数据库、无内存生产回退、无新增付费存储。默认七个版块属于系统配置，不包含示例帖子、虚构社团活动或比赛成绩。

## 发布顺序

1. 备份现有数据库、云函数 ZIP/环境配置与前端构建版本。保留当前管理员及其密码，不运行 bootstrap、不重装基础数据库。
2. CloudBase PostgreSQL SQL 编辑器完整执行 `cloudbase/sql/009-stage4-forum.sql`。前提是已有第三阶段表和 `ec_assert_backend_role/ec_commit`。使用原 SQL 编辑器身份即可；脚本不 CREATE/ALTER ROLE、不改密码、不清空旧表，在一个事务中执行。已有表和版本安全重试；默认版块 ON CONFLICT DO NOTHING，管理员改过的版块不会被覆盖。新权限只写 permissions 定义，不自动授予现有职位或普通角色。
3. 执行 `cloudbase/sql/verify-stage4-forum.sql` 核对版本、表、约束、默认版块和权限。迁移失败应确认整份事务回滚，不把某条成功输出当成迁移完成。
4. 从本分支的 `deployment-packages/electronicclub-api.zip` 下载完整 ZIP，上传现有 `electronicclub-api`。ZIP 根目录是 `index.js`、`package.json`、`package-lock.json`、`node_modules` 等，不再套一层目录。入口仍为 **index.main**，编译目标及完整依赖适配现有 **Node.js18.15**。不新建函数、环境或网关域名；保留现有 `/api` 路由。
5. 核对 API：health 200；匿名 GET `/api/forum/boards`、`/api/forum/posts` 200（允许空帖子列表）；匿名 GET `/api/forum/me/posts` 401。这些公开论坛查询实际访问PG，不能用health或未登录me401替代数据库验收。
6. 现有超级管理员在角色/权限界面明确配置九个 `forum.*` 权限。不把会长、副会长等职位硬编码成管理者。角色变更沿用旧会话撤销机制，受影响成员需重新登录。
7. 后端验收成功后再将前端对应分支部署到 EdgeOne Makers。保持 Node22 构建、`npm ci`、`npm run build -w @electronic-club/web`、输出 `apps/web/dist`，保留已有公开 `VITE_API_BASE_URL`。`edgeone.json` 已覆盖 `/community` 和 `/community/*`，包括帖子、个人社区、新建与编辑页面；不要把 `/api` 改写成index.html。
8. 私密窗口及375/430/1440/1920宽度核对首页、详情及后台；完成下文登录、发帖和原JPG上传验收，再对成员开放。

若维护时重跑旧基础安装或008，会收窄 `ec_table` 集合白名单；必须最后再执行009。本任务不运行生产迁移、不创建正式账号、不修改DNS。

## 环境与网关

现有环境为 `natural-tuna-d6gptlw1w76fa8a63`，函数 `electronicclub-api`。默认网关：

```
https://natural-tuna-d6gptlw1w76fa8a63-1448063817.ap-shanghai.app.tcloudbase.com
```

延续原 `DB_DRIVER=cloudbase-http`、`CLOUDBASE_ENV_ID`、服务端临时身份/受保护凭据配置、`ALLOWED_ORIGIN=https://eclub.gut9.cn` 和现有安全Cookie配置。不要新增前端管理员Key；浏览器只能调用API，不能直接以service_role访问数据库。跨站Cookie仍需原HTTPS/SameSite设置及浏览器策略验收。`COOKIE_SECURE=false`只用于隔离本地测试，不要复制进云环境。

可选 `FORUM_IMAGE_BUDGET_BYTES`：全局内嵌图片编码文本预算，默认33554432（32MiB），范围1024至536870912。这个值是项目自设上限，不是腾讯云免费配额承诺；仅在确认实际数据库剩余额度后调整。预算不含PG行、索引及审计开销。达到预算会拒绝新图片，不自动购买空间。未配置时即可使用。

CloudBase默认域名的开发测试使用限制、体验版配额、Node18上游EOL等原有正式运营限制仍存在；本任务不通过反向代理规避限制，不声称可据此保证500人生产运营。

## 数据库与存储

九个新表：forum_boards、forum_posts、forum_comments、forum_likes、forum_favorites、forum_reports、forum_user_restrictions、forum_notifications、forum_images。JSONB继续由原事务存取，数据库生成关联列、外键及索引约束补强业务层：

- 所有论坛行的JSON id必须等于实际主键。
- 帖子关联版块与现有users；评论关联帖子/作者，回复父评论必须属于同一帖。
- 评论每帖楼层唯一，删除后不重排；被删除评论保留公开占位，不公开旧正文。
- 点赞、收藏 `(post_id,member_uid)` 唯一，复合主键同样检查，active=true/false幂等。
- 举报目标与帖子/评论关系受约束；通知关联收件人、帖子、可选评论。
- 图片关联上传者与可选帖子。未发布图片仅本人可读；公开图片必须仍被公开帖子引用，且所在版块可公开。
- 帖子/评论默认软删除；没有公开硬删除或级联清空API。外键阻止孤立评论、回复、点赞和收藏。原成员匿名化保留UID，公开作者仅使用当前昵称/头像，注销后显示“已注销成员”；不公开学号、真实姓名字段、学院、班级、手机或邮箱。

`ec_forum_list` 是单独受保护的服务端分页RPC；筛选、搜索、排序、公开版块/帖子检查、收藏关联在SQL执行，返回count和当前页。帖子和评论不会先全部下载再内存分页。查询采用固定SQL+参数化JSON，列/表/排序白名单，不能拼接用户SQL。native pg适配器使用同一查询模板。迁移由 `npm run forum:sql:generate` 生成，`npm run check`检查生成文件未过期。

索引覆盖版块/状态/置顶/创建时间、精华/最新回复、作者帖子、帖子评论楼层、作者评论、成员收藏、收件通知、举报状态和上传者/暂存状态。搜索采用参数化子串匹配；大规模内容增长后需依据真实负载再评估中文检索方案，不能把本地测试当成生产性能压测。

## 图片与413防护

沿用现有PG图片方式，不创建额外对象存储：每帖最多3张，原文件PNG/JPEG/WebP不超过1MB，论坛图片在浏览器解码后重新编码（剥离原EXIF等元数据、长边最多1600像素）并压缩到单张32KiB以内，然后**每张单独上传**，帖子只发送图片UUID列表。服务端独立检查Base64规范、真实容器/签名、尺寸、PNG CRC/解压边界、JPEG段及结尾、WebP长度与帧；拒绝SVG、伪装EXE、尾随载荷、动画WebP/PNG及超限图片，不允许任意成员绑定他人图片。

所有论坛JSON请求前后端都执行64KiB保守预算。此为项目安全预算，并非已确认的CloudBase官方网关上限。图片以限定MIME的inline二进制响应、nosniff、no-store输出；应在真实CloudBase上确认isBase64Encoded网关解码。帖子正文不带多张Base64，不再复用已确认会413的大JSON上传方式。

频率：每成员发帖30秒内1次/每小时10次、评论5秒内1次/每小时60次、图片10分钟6张、互动每分钟30次、举报每日5次。暂存图片每成员最多6张。图片预算计数与插入/移除在同一原事务中调整，避免并发超支。

未发布图片超过24小时可通过ZIP内私有 `forum-maintenance.js --cleanup-staged` 清理，每次最多50张，可重复运行；只在有授权的私有终端、使用原受限服务端数据库身份执行。不是HTTP接口，不要求控制台Agent运行Linux命令。它只删除仍未绑定帖子的过期图片、扣减预算并写审计；已发布/已绑定图片不会被该命令清理。软删除帖子的图片保留，以便受控复核；需结合实际空间定期评估保留周期，不做未经确认的永久删除。

## 角色与内容规则

新权限：forum.boards.manage、forum.posts.review、forum.posts.pin、forum.posts.feature、forum.posts.lock、forum.posts.delete、forum.comments.moderate、forum.reports.manage、forum.users.restrict。

普通活跃成员默认能管理本人帖子、评论回复、点赞、收藏、举报与个人通知，无需新增职位角色。后端绑定作者UID；请求中的id、authorUid、status等越权字段不接受。后台按钮按权限显示，后端仍独立校验。限制只影响社区发帖/评论，不改变成员账号登录、角色和活动报名。

版块hidden不公开，disabled公开只读；帖子草稿队列使用pending，版块可以选择发布需审核。被管理员隐藏的帖子由作者修改后仍进入pending，不能靠编辑自行解除审核。锁帖禁止普通成员评论和修改正文；关闭评论单独控制。管理员处理需原因并写原audit_logs；历史原因和状态保存在审计details中，只向具有对应管理权限的角色返回详情。相关作者和举报人收到站内通知。通知按需分页获取，无WebSocket。浏览量按已登录成员每帖24小时去重统计，界面明确标为成员浏览，不虚构游客浏览数。

## 新增API

以下路径都带 `/api/forum` 前缀。写操作均为POST，需登录Cookie、严格Origin、X-Requested-With和JSON；服务端校验会话/账号状态及频率。公开GET在匿名状态只返回公开内容，所有响应no-store。

| 方法与路径 | 行为 / 权限 |
| --- | --- |
| GET /boards、/boards/:id | 公开版块分页；admin=true需boards.manage |
| POST /boards、/boards/:id | 创建/编辑/排序/隐藏/停用，boards.manage |
| GET /posts | 公开帖子分页；boardId/search/sort=latest/reply/hot/featured |
| POST /posts | 当前成员发布，作者服务端绑定，可进入pending |
| GET /posts/:id | 公开详情；本人或授权审核人可读未公开帖子 |
| POST /posts/:id/update | 仅本人修改；锁帖拒绝，隐藏后修改仍需审核 |
| POST /posts/:id/delete | 本人软删除 |
| GET /posts/:id/comments | 分页评论/回复；anchor可定位通知对应楼层 |
| POST /posts/:id/comments | 发表评论/回复，父评论必须同一帖子 |
| GET /posts/:id/state | 当前成员的点赞/收藏/归属 |
| POST /posts/:id/like | active布尔值，幂等点赞/取消 |
| POST /posts/:id/favorite | active布尔值，幂等收藏/取消 |
| POST /posts/:id/view | 登录成员去重浏览计数 |
| POST /posts/:id/moderate | action=approve/hide/delete/pin/feature/lock/close-comments，逐项权限+reason |
| POST /comments/:id/delete | 删除本人评论，保留楼层占位 |
| POST /comments/:id/moderate | 评论公开/隐藏/删除，comments.moderate+reason |
| POST /images | 单张32KiB图片暂存，返回UUID和尺寸 |
| GET /images/:id | 公开已发布附图；私有暂存或未公开附图需正确身份 |
| POST /images/:id/delete | 移除本人未发布图片 |
| POST /reports | 举报帖子或评论，绑定举报人 |
| POST /reports/:id | 举报处理，reports.manage，status/resolution |
| GET /restrictions | 限制列表，users.restrict |
| POST /restrictions | 按规范化学号设置/解除发帖和评论限制，users.restrict |
| GET /me/posts、/me/comments、/me/favorites | 当前成员内容，分页 |
| GET /me/notifications、/me/reports、/me/restrictions | 当前成员通知/举报/限制 |
| POST /me/notifications/:id | 只标记本人通知已读 |
| GET /admin/posts | 按自身管理权限取帖子分页；仅置顶等权限不可读取未公开内容 |
| GET /admin/comments | 评论管理分页，comments.moderate |
| GET /admin/reports | 举报管理分页，reports.manage |
| GET /admin/audit | 仅forum.*审计记录，任一论坛管理权限 |

## 控制台与终端分工

- SQL编辑器：执行009与核对SQL；Agent仅在实际提供SQL工具时可代执行，不假设它能解压ZIP或启动终端。
- 控制台手动：上传已提供的完整ZIP，核对index.main及Node运行时，保留环境变量和网关，查看日志与请求ID。
- 已授权私有终端：可选暂存图片清理；不得把数据库凭据放进前端或聊天。
- EdgeOne：后端成功后更新相应分支构建，检查SPA刷新和真实跨域Cookie。无新付费UI库、网络服务或自动套餐升级。

## 验收与回滚

使用专用测试成员/测试帖子，避免伪造正式社团内容。验证普通成员发帖/修改、别人不能盗改、评论/同帖回复、通知定位、收藏/幂等点赞、搜索分页；再验证审核、隐藏、加精置顶、锁帖/关评论、举报处理、限制与解禁。用原129,028字节JPG验证分次上传后请求小于64KiB，检查函数图片二进制响应和手机显示。随后回归登录/改密、角色分配、Excel、活动报名/签到、新闻与弹窗。

代码回滚：恢复上一份函数ZIP与前端同版本；009新增表、权限元数据和扩展RPC可以保留，不DROP/TRUNCATE，不删除报名或论坛历史。旧版不能使用论坛功能，暂不要用旧后端编辑含新论坛权限的角色。恢复新版后再管理新权限。没有自动破坏性数据库降级脚本；如确需永久清理，需独立备份和审查。

本地真实PG/浏览器/Node18打包测试不等于腾讯云生产验证。真实环境迁移、二进制网关、跨站Cookie、套餐配额与成员规模下性能需按此流程验收。默认域名生产限制和Node18生命周期问题需在正式运营前处理。

## 本次实际验证与尚未执行的操作

- `npm ci`成功；`npm run check`在真实本地PostgreSQL启用时通过50项测试，0失败、0跳过，包含ESLint、TypeScript、前后端生产构建及原成员/活动/弹窗回归。
- 009在无CREATEROLE的真实schema owner下执行两次；原users/roles/credentials/sessions/student_ids、活动/报名/签到、文章/弹窗及system内容摘要保持一致。验证匿名数据库角色无表/RPC访问权限，原生pg与HTTPS-RPC分页结果一致，回复外键/唯一楼层/点赞并发/事务回滚均通过。
- 浏览器连接隔离真实PG和生产HttpStore/RPC路径，完成普通成员发帖、用户原JPG、回复、点赞收藏、举报/通知及管理员审核/置顶加精/锁帖/限制；375/430/1440/1920无横向溢出。真实PNG/WebP上传、二进制解码和暂存移除通过；HTML以文字显示，未执行脚本。所有这些测试数据只在隔离本地数据库，不进入ZIP或生产库。
- 完整部署入口在实际Node18.15下，通过本地受控身份交换桥接及真实PG service_role验证登录/首次改密/论坛写读/图片二进制响应/通知和私有清理命令。该桥接不是腾讯云真实认证或部署验证。
- `npm audit --omit=dev`返回非零：仍有10项moderate，0 high/critical；本阶段未新增运行依赖。既有Excel/ZIP依赖链告警未清零，输入限制、解压限制、公式防护、权限与CSRF继续保留。Node18生命周期风险仍存在。
- 尚未执行：生产009、云函数上传、真实网关图片解码/Cookie验收、实际配额及大规模负载验证。不能声称论坛已上线。迁移/后端/前端应按发布顺序由操作人验收。
