# ElectronicClub · 电子俱乐部

电子俱乐部成立于1991年，挂靠物理与电子科学学院，以培养电子技术基本技能、开展工程实践与创新为宗旨。官网保留现有蓝白视觉和正式Logo，不展示未经确认的现任成员、指导老师或虚构获奖记录。

当前代码包含成员账号/强制改密/Excel导入/动态RBAC，以及活动报名签到、新闻公告、全站弹窗和第四阶段电子社区。论坛支持版块、本人发帖与附图、评论回复、点赞收藏、站内通知、举报，以及按权限配置的审核/置顶/加精/锁帖/限制。采用真实CloudBase PostgreSQL HTTPS RPC，可选原生pg，不使用生产内存回退。

**最新升级顺序：已有 012 的数据库先执行 [013-member-stats-resources.sql](cloudbase/sql/013-member-stats-resources.sql)，再上传最新完整云函数 ZIP，最后更新 EdgeOne 前端。缺少前置迁移时先依次补齐。不要重新初始化数据库或管理员。**

- [成员使用统计与七牛公开资料库部署](docs/resources-deploy.md)
- [成员登录记录：姓名、学号、IP、设备与权限/隐私说明](docs/login-history-deploy.md)
- [正文图片、权限分组和界面优化部署说明](docs/content-media-deploy.md)
- [角色成员与有效权限管理](docs/access-workspace-deploy.md)
- [完整云函数 ZIP 及 SHA256](deployment-packages/README.md)
- [第四阶段论坛部署与 API](docs/stage4-deploy.md) · [第三阶段部署](docs/stage3-deploy.md) · [成员系统部署](docs/member-system.md)

活动、新闻、帖子可在正文光标处插入图片，支持安全表格和预览。新封面、弹窗及正文图片允许 3MB 原图，浏览器压缩至 50KiB 以内，每篇正文最多12张。图片分成不超过24KiB的片段上传，浏览器请求和 SQL RPC 均控制在64KiB以内；正文只保存图片引用，避免 Base64 造成网关413。保留旧图片与全部业务API，无新增付费存储；共享现有默认32MiB图片预算和私有过期暂存清理。

本地检查、真实 PG/RPC 及浏览器测试不等于腾讯云上线验收；本任务未自动上传云函数、执行生产SQL或创建正式账号。部署步骤与回滚见最新部署文档。

## 开发环境

使用 Node.js 22.12+（推荐 Node 22 LTS，当前云端 Node 24 也已验证）和 npm 10+，在仓库根目录执行：

```bash
npm ci
npm run dev:api
# 另一个终端，仍在仓库根目录
npm run dev
```

前端默认端口 5173，后端默认端口 3001。Vite 将 `/api` 转发到本地后端。在任意官网页面的页脚点击“检查服务连接”，成功显示“后端连接正常”。官网和健康检查默认不需要密钥；成员业务需要配置真实 CloudBase 数据库，或按照部署文档显式启用仅本地使用的内存适配器。

```bash
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:5173/api/health
```

`.env.example` 列出当前配置。前端统一同源请求 `/api`：本地由 Vite 转发，EdgeOne 由根目录 `edge-functions/api` 转发，Linux 由 Caddy 转发。旧 `VITE_API_BASE_URL` 不再控制浏览器请求，可删除。EdgeOne 的 `API_UPSTREAM_ORIGIN` 是可选服务端固定源地址，不含 `/api`；默认沿用当前 CloudBase 网关。后端 `ALLOWED_ORIGIN` 精确填写前端源地址，不带尾部 `/`。详见[同源 API 升级](docs/same-origin-api.md)。本地后端不自动读取 `.env`。

## 目录

```text
apps/
  web/                 Vue 3 + TypeScript + Vite
    src/api.ts         API 请求与健康响应校验
    src/stores/        Pinia 状态
    src/views/         首页、介绍、列表/详情、登录、后台布局
    src/components/    Logo、页面标题、空状态、工程示意图等
    src/layouts/       共享导航与页脚
    src/content.ts     已确认社团资料与培养方向
    src/brand.ts       正式 Logo / favicon 接入
    src/style.css      设计变量与响应式样式
    src/assets/        用户确认的透明背景 Logo
  functions/           Node.js + TypeScript 云函数
    src/index.ts       CloudBase 入口 main，HTTP 请求分发
    src/local.ts       本地 HTTP 适配器
packages/shared/       前后端共享 API 类型、路径常量
tests/                云函数协议、错误路由与 CORS 测试
.github/workflows/     GitHub Actions CI
edgeone.json           EdgeOne 构建与已知页面的 SPA 回退
```

前端由 Vue Router 管理页面，使用 Pinia 保存健康检查状态，Element Plus 按需提供健康检查按钮与登录输入框，页面排版使用自定义布局。后端类型引用在编译时擦除，本阶段云函数使用 CloudBase SDK、Zod、ExcelJS 和 ZIP 预检依赖，必须安装云函数运行依赖。

## 检查和构建

在根目录执行：

```bash
npm run lint           # ESLint，覆盖 TS、Vue 和配置
npm run typecheck      # 所有 workspace 的 TS / Vue 类型检查
npm test               # Node test runner + tsx，成员与安全行为测试
npm run build          # 顺序构建共享包、云函数和前端
npm run check          # 上述全部检查，CI 使用相同命令
```

前端产物为 `apps/web/dist`，云函数 CommonJS 产物为 `apps/functions/dist`，共享声明产物为 `packages/shared/dist`。`npm run build` 本身不执行类型检查，因此 CI 和提交前请使用 `npm run check`。依赖版本由根目录 `package-lock.json` 锁定，刷新环境使用 `npm ci`。测试不依赖云资源，但不替代部署后的真实云端检查。

Codex 云端任务应使用已有检出目录 `/workspace/ElectronicClub`，无需另建 worktree。先执行 `npm ci`，再执行 `npm run check`；需要联调时分别运行 `npm run dev:api` 与 `npm run dev`，通过上述两个健康请求验证。服务进程需要在新任务中重新启动，不能依赖环境快照保留进程。

## 部署架构

```text
浏览器 ──> EdgeOne Makers 静态站点（apps/web/dist）
   └─ HTTPS /api/health ──> CloudBase HTTP 服务 ──> Node 云函数
                                                 └─ CloudBase 文档数据库（成员与权限）
```

### CloudBase 后端

1. 创建 CloudBase 环境和 Node.js 云函数（例如 `electronicclub-api`），选择平台可用的 Node.js 22.12+ 运行时，入口为 `index.main`。若目标环境没有该运行时，须先核对支持版本并调整构建目标、复测依赖，不能直接沿用旧的 Node.js 18 部署说明。
2. 在根目录运行 `npm run check`，将 `apps/functions/deploy` **目录内**的 `index.js` 和 `package.json` 上传至云函数代码根目录，按该清单安装运行依赖。不要再只上传旧的 dist；具体初始化、规则和身份配置见成员系统部署文档。
3. 配置 CloudBase 的 HTTP 访问服务，将 `/api` 路由关联到该函数，确保传给函数的事件含原始 `path`、`httpMethod`、`headers`，访问 `/api/health` 时 `path` 为 `/api/health`。使用支持 `{statusCode, headers, body}` 返回结构的 HTTP 集成；在控制台核对集成设置。若平台剥离 `/api` 前缀或包裹响应，需调整 HTTP 服务映射，不要仅凭云函数控制台直接调用认定 HTTP 集成成功。
4. 为公开健康检查开放相应 HTTP 访问权限，配置 `ALLOWED_ORIGIN` 为最终前端源地址。它仅控制浏览器 CORS，不是鉴权方案。仅开放必要路由；未来敏感接口需要单独设计鉴权。
5. 使用真实 HTTPS 地址请求 `/api/health`，确认状态码 200、Content-Type 为 JSON、响应是下述协议，再验证 OPTIONS 和来自前端源地址的 CORS 响应。

成员系统由云函数通过服务端身份访问真实文档数据库；集合、索引和拒绝客户端访问规则见 `cloudbase/` 与部署文档。浏览器不保存管理密钥。

### EdgeOne Makers 前端

1. 导入 GitHub 仓库，使用仓库根目录作为构建工作目录（共享 workspace 位于根目录）。
2. 安装命令 `npm ci`，构建命令 `npm run build -w @electronic-club/web`，输出目录 `apps/web/dist`。Node 版本选择 22.12+。
3. 保留根目录 `edge-functions/api/index.ts` 与 `edge-functions/api/[[path]].ts`，让平台与前端一起构建部署，不能只上传 dist 静态文件。前端统一请求官网 `/api`，旧 `VITE_API_BASE_URL` 不再生效；不需要将数据库或 CloudBase Key 加入前端。默认转发当前网关，换后端时只修改 EdgeOne 函数的 `API_UPSTREAM_ORIGIN`。登录 IP 签名的可选配置见[同源 API 升级](docs/same-origin-api.md)。
4. 根目录已添加 `edgeone.json`，记录上述构建参数，并为 `/about`、`/resources`、`/news`、`/activities`、`/community`、`/login`、`/admin`、`/account`、`/change-password`、`/admin/*` 及三类详情路径配置到 `/index.html` 的重写。规则不覆盖 `/assets/*` 或 `/api/*`。确保平台读取仓库根配置；如控制台配置覆盖仓库配置，应同步这些参数。配置字段及路径语法已对照官方 npm 包 `edgeone@1.6.47` 核对，腾讯云线上路由仍需部署后实际刷新验证。后续新增页面需同步重写规则；`tests/edgeone-routing.test.ts` 会对照 Vue 路由检查覆盖，避免站内跳转正常而刷新404。
5. 在部署后的首页点击页脚“检查服务连接”，实际请求应为官网 `/api/health`，响应带 `X-EClub-API-Transport: same-origin`。随后验证登录、刷新和退出；只健康200不代表登录成功。云部署需要腾讯云账号及实际平台支持，不自动创建收费资源。

## 云端与 Linux 双部署交付

现有 CloudBase + EdgeOne 继续使用。Linux备用部署包与加密备份/恢复/升级工具见[服务器说明](docs/linux-server.md)，真实迁移须由用户另行提出。重大更新提升 `release/major.json` generation，发布流程按内容摘要更新 `deployment-packages/electronicclub-linux.tar.gz` 与 `electronicclub-operations.tar.gz`；小更新不重打这两个包，无变化的组件保持原文件与SHA256。规则记录在AGENTS.md。CI同时检查现有PG/HTTPS-RPC业务和隔离Linux HTTPS/数据库/备份恢复/升级，普通检查只产生临时测试构建，不覆盖稳定包。

## API

成员彻底删除：新增 `members.purge` 独立权限，需执行014迁移并更新函数/前端，见[部署与删除范围](docs/member-purge-deploy.md)。仅适用于无业务关联的已软删除账号，不会级联删除活动或论坛内容。

活动流程优化：015新增报名名单数据库分页，配套函数/前端提供独立审核和签到入口、姓名多选及按角色批量负责人、自定义签到有效期，见[升级说明](docs/event-operations-deploy.md)。

`GET /api/health` → HTTP 200：

```json
{"success":true,"data":{"status":"ok","service":"ElectronicClub API","timestamp":"2026-01-01T00:00:00.000Z"}}
```

时间为服务端当前 ISO 时间，示例仅表示格式。未知路径返回 404，已知路径的不支持方法返回 405；错误体为 `{"success":false,"error":{"code":"...","message":"..."}}`。`OPTIONS /api/health` 返回 204，匹配 `ALLOWED_ORIGIN` 时带允许来源头；未配置时不允许浏览器跨域读取。本地 Vite 代理属于同源请求。

## 页面与当前能力

| 路由 | 当前能力 |
| --- | --- |
| `/` | 正式社团信息、培养方向、电赛介绍、活动与公告空状态、社区入口 |
| `/about` | 社团介绍与电赛实践理念 |
| `/news`、`/activities`、`/community` | 统一列表视觉与真实空状态，无示例内容 |
| `/news/:id`、`/activities/:id`、`/community/:id` | 详情布局及未找到状态，无虚构正文 |
| `/login` | 学号密码登录，失败提示、会话Cookie |
| `/change-password` | 首次强制改密及后续改密 |
| `/account` | 真实用户档案、自助资料修改、登出和会话撤销 |
| `/admin`、`/admin/members`、`/admin/members/:id` | 鉴权后的管理导航、成员查询/创建/编辑/角色/密码/状态/删除 |
| `/admin/imports` | XLSX模板、上传预览、错误导出、确认与分批导入 |
| `/admin/roles`、`/admin/permissions` | 数据库角色及分组权限配置 |
| `/admin/audit` | 受权限保护的审计查询 |
| 其他前端路径 | 站内 404 页面；未知路径直达的 HTTP 状态取决于部署平台 |

官网导航、移动菜单、锚点和健康检查保持可用。第二阶段代码实现成员登录、资料、管理、导入与RBAC，只有配置并部署数据库后才能用于生产；本地可显式使用测试适配器。内容发布、论坛发帖评论、活动报名尚未实现。后台现已由路由守卫和每个服务端接口的实时权限校验共同保护，不再是公开布局预览。

## 设计与资源

`src/style.css` 集中定义蓝白主色、红色强调、字体、间距、边框、圆角和阴影变量。布局使用细线分区与留白，避免后台卡片模板；导航和页脚复用，路由懒加载。PCB 与波形为自行绘制的轻量 SVG 工程示意图，不是正式标志，也不冒充社团作品。使用系统字体，没有外部字体、素材 CDN 或付费组件依赖。提供跳转正文链接、可见键盘焦点和减少动画偏好支持。

Logo 已接入：使用用户在对话中明确确认的第二张透明背景版本，实际文件为 `apps/web/src/assets/electronic-club-logo.png`。资源按原文件复制，未进一步重绘、改色或改变比例。导航、首页和页脚共用该资源，`brand.ts` 将同一 PNG 注册为 favicon；Vite 输出带哈希的资源地址，浏览器复用缓存。

## 第二阶段验证与部署状态

`npm run check` 执行 lint、所有 workspace 类型检查、自动化安全测试与生产构建。测试使用独立的内存适配器，覆盖登录/强制改密/撤销、身份不可变字段、权限并集/越权、最后超级管理员、导入去重及前导零。另用真实 Chromium 在1440/1920/375/430px检查官网、用户中心与管理页面，实际走通本地账号创建、角色编辑、XLSX导入、首次改密与会话恢复。

**尚未进行真实 CloudBase 事务、索引、身份凭据、网关 Cookie/CORS 或 EdgeOne 部署验证**。生产必须完成 [部署与初始化步骤](docs/member-system.md)，不能把本地测试通过当作已上线。依赖审计状态和已知限制也在该文档中说明。

## Git 协作

仓库已有 `main`，无需重新初始化。后续改动使用功能分支，提交、推送后创建面向 `main` 的 Pull Request。不要重置远端历史或强制推送。

## 学号规则与初始化昵称

学号支持4–24位ASCII英文字母与数字，统一大写、大小写不敏感；不接受空格或特殊字符，始终按字符串保存并保留前导零。共享规则位于 `packages/shared/src/student-id.ts`。初始化命令支持安全环境变量 `BOOTSTRAP_NICKNAME`，不硬编码个人资料。纯数字账号无需迁移；若有手工写入的小写字母数据，先执行只读碰撞审计再按 [安全迁移方案](docs/student-id-migration.md)处理，不能直接覆盖映射。本次仅完成代码修复和测试，未初始化或修改生产数据库。

## 网页显示 API 连接失败

页脚“检查服务连接”只请求 `/api/health`，不连接数据库，不需要CLOUDBASE_APIKEY。失败时展开“连接诊断”查看实际请求地址。HTTP404、返回HTML网页、超时、网络/CORS错误会分别提示；网络错误不能仅凭浏览器fetch异常判断一定是CORS。

最新版本通过 EdgeOne 边缘函数处理官网 `/api`，不再从浏览器跨站调用默认网关。旧 `VITE_API_BASE_URL` 不影响新产物；若 `/api/health` 返回404或HTML，应检查部署是否包含根目录边缘函数，不能把API回退到index.html。后端仍保留 `ALLOWED_ORIGIN=https://eclub.gut9.cn`，不带尾部 `/`。详见[部署、验收及回滚](docs/same-origin-api.md)。

`CLOUDBASE_APIKEY`是本项目自定义的后端配置名，不是控制台内置选项。目前尚未验证该环境的Key获取与SQL角色授权方式；不要把管理员密码填进去。数据库连接与前端健康检查需分别验收。默认网关仅限开发测试，不能据此宣称正式生产登录或跨站Cookie可用。

最新同源入口适用默认 Secure/HttpOnly/SameSite=Lax Cookie，无需关闭 Safari 跨站跟踪防护。已有 `COOKIE_SAMESITE=none` 也能经同源入口工作，可在迁移完成后恢复lax。旧版跨站产物仍可能被第三方Cookie策略拦截，历史联调说明不代表推荐架构；详见[Safari/QQ登录与Cookie核对](docs/mobile-login.md)。

## 第三阶段（已包含于main）

活动发布、成员报名/审核/取消、签到/补签、名单XLSX导出、新闻公告和全站弹窗已实现，延续现有登录、RBAC和官网风格。部署与完整API清单见 [第三阶段部署手册](docs/stage3-deploy.md)，升级SQL为 [008-stage3.sql](cloudbase/sql/008-stage3.sql)。ZIP和SHA256位于deployment-packages。

第三阶段代码已包含于main。第四阶段沿用同一套账号、会话、角色与事务接口；新增部署请以第四阶段文档为准。此交付不重置账号或自动执行生产SQL。
