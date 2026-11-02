# ElectronicClub · 电子俱乐部

电子俱乐部成立于1991年，挂靠物理与电子科学学院，以培养电子技术基本技能、开展电子设计与创新实践、通过学科竞赛促进学习为宗旨。本项目不包含未经确认的现任成员或指导老师资料。

当前工程提供蓝白工程风官网、多页面视觉结构、健康检查、共享 API 类型和可复现的开发与构建流程。仅发布用户确认的社团信息；重点赛事只展示全国大学生电子设计竞赛（电赛），没有虚构成员、指导老师、活动或获奖记录。论坛、报名、Excel 导入、RBAC 和数据库读写留待后续开发。

## 开发环境

使用 Node.js 22.12+（推荐 Node 22 LTS，当前云端 Node 24 也已验证）和 npm 10+，在仓库根目录执行：

```bash
npm ci
npm run dev:api
# 另一个终端，仍在仓库根目录
npm run dev
```

前端默认端口 5173，后端默认端口 3001。Vite 将 `/api` 转发到本地后端。在任意官网页面的页脚点击“检查服务连接”，成功显示“后端连接正常”。默认不需要密钥、不需要 CloudBase 账号，也不启动数据库。

```bash
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:5173/api/health
```

`.env.example` 列出全部当前配置。可将其中 `VITE_API_BASE_URL` 放入 `apps/web/.env.local`；它是公开的后端 URL，不能包含密钥。前端环境变量在构建时写入产物。生产跨域调用时将其设为 CloudBase HTTP 服务的源地址（不含 `/api/health`，不附带尾部路径）。后端 `ALLOWED_ORIGIN` 在 CloudBase 控制台设为前端源地址，例如 `https://club.example.com`，不包含尾部 `/`。本地需要这些变量时通过进程环境传入；本地后端不自动读取 `.env`。

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
    src/assets/        原图接入目录（原始 Logo 尚待提供）
  functions/           Node.js + TypeScript 云函数
    src/index.ts       CloudBase 入口 main，HTTP 请求分发
    src/local.ts       本地 HTTP 适配器
packages/shared/       前后端共享 API 类型、路径常量
tests/                云函数协议、错误路由与 CORS 测试
.github/workflows/     GitHub Actions CI
edgeone.json           EdgeOne 构建与已知页面的 SPA 回退
```

前端由 Vue Router 管理页面，使用 Pinia 保存健康检查状态，Element Plus 按需提供健康检查按钮与登录输入框，页面排版使用自定义布局。后端类型引用在编译时擦除，当前云函数无运行时第三方依赖。

## 检查和构建

在根目录执行：

```bash
npm run lint           # ESLint，覆盖 TS、Vue 和配置
npm run typecheck      # 所有 workspace 的 TS / Vue 类型检查
npm test               # Node test runner + tsx，3 项后端行为测试
npm run build          # 顺序构建共享包、云函数和前端
npm run check          # 上述全部检查，CI 使用相同命令
```

前端产物为 `apps/web/dist`，云函数 CommonJS 产物为 `apps/functions/dist`，共享声明产物为 `packages/shared/dist`。`npm run build` 本身不执行类型检查，因此 CI 和提交前请使用 `npm run check`。依赖版本由根目录 `package-lock.json` 锁定，刷新环境使用 `npm ci`。测试不依赖云资源，但不替代部署后的真实云端检查。

Codex 云端任务应使用已有检出目录 `/workspace/ElectronicClub`，无需另建 worktree。先执行 `npm ci`，再执行 `npm run check`；需要联调时分别运行 `npm run dev:api` 与 `npm run dev`，通过上述两个健康请求验证。服务进程需要在新任务中重新启动，不能依赖环境快照保留进程。

## 部署架构

```text
浏览器 ──> EdgeOne Makers 静态站点（apps/web/dist）
   └─ HTTPS /api/health ──> CloudBase HTTP 服务 ──> Node 云函数
                                                 └─ CloudBase 文档数据库（后续阶段）
```

### CloudBase 后端

1. 创建 CloudBase 环境和 Node.js 云函数（例如 `electronicclub-api`），选择控制台支持的 Node.js 18.15 或更新运行时。当前输出目标为 ES2022，入口为 `index.main`。
2. 在根目录运行 `npm run check`，将 `apps/functions/dist` **目录内**编译后的文件上传至云函数代码根目录，使 `index.js` 位于根目录。当前无运行时依赖，不要上传整个 Monorepo 或 `node_modules`。
3. 配置 CloudBase 的 HTTP 访问服务，将 `/api` 路由关联到该函数，确保传给函数的事件含原始 `path`、`httpMethod`、`headers`，访问 `/api/health` 时 `path` 为 `/api/health`。使用支持 `{statusCode, headers, body}` 返回结构的 HTTP 集成；在控制台核对集成设置。若平台剥离 `/api` 前缀或包裹响应，需调整 HTTP 服务映射，不要仅凭云函数控制台直接调用认定 HTTP 集成成功。
4. 为公开健康检查开放相应 HTTP 访问权限，配置 `ALLOWED_ORIGIN` 为最终前端源地址。它仅控制浏览器 CORS，不是鉴权方案。仅开放必要路由；未来敏感接口需要单独设计鉴权。
5. 使用真实 HTTPS 地址请求 `/api/health`，确认状态码 200、Content-Type 为 JSON、响应是下述协议，再验证 OPTIONS 和来自前端源地址的 CORS 响应。

此阶段没有数据库集合、SDK 初始化或数据库权限规则。后续在云函数中通过 CloudBase 服务端身份访问文档数据库，避免在浏览器放置管理密钥。

### EdgeOne Makers 前端

1. 导入 GitHub 仓库，使用仓库根目录作为构建工作目录（共享 workspace 位于根目录）。
2. 安装命令 `npm ci`，构建命令 `npm run build -w @electronic-club/web`，输出目录 `apps/web/dist`。Node 版本选择 22.12+。
3. 设置构建变量 `VITE_API_BASE_URL=https://你的CloudBaseHTTP服务域名`，重新构建部署。不要将 CloudBase 密钥配置为 Vite 变量。
4. 根目录已添加 `edgeone.json`，记录上述构建参数，并为 `/about`、`/news`、`/activities`、`/community`、`/login`、`/admin` 及三类详情路径配置到 `/index.html` 的重写。规则不覆盖 `/assets/*` 或 `/api/*`。确保平台读取仓库根配置；如控制台配置覆盖仓库配置，应同步这些参数。配置字段及路径语法已对照官方 npm 包 `edgeone@1.6.47` 核对，腾讯云线上路由仍需部署后实际刷新验证。后续新增页面需同步重写规则。
5. 在部署后的首页点击页脚“检查服务连接”，验证真实前端到 CloudBase 的请求和 CORS。云部署需要腾讯云账号、环境与域名，本初始化不创建收费资源，也不声称已部署。

## API

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
| `/login` | 登录视觉结构，输入与提交禁用，不收集凭据 |
| `/admin` | 仅公开的后台布局预览，可切换内容区域；没有任何后台业务数据或管理操作 |
| 其他前端路径 | 站内 404 页面；未知路径直达的 HTTP 状态取决于部署平台 |

真实可用的功能包括路由导航、移动菜单、锚点定位、服务健康检查。内容发布、论坛发帖评论、账号登录/用户中心、权限控制、报名和数据库功能尚未实现。后台布局预览不是权限保护实现，后续必须接入服务端鉴权后才可以开放管理 API。

## 设计与资源

`src/style.css` 集中定义蓝白主色、红色强调、字体、间距、边框、圆角和阴影变量。布局使用细线分区与留白，避免后台卡片模板；导航和页脚复用，路由懒加载。PCB 与波形为自行绘制的轻量 SVG 工程示意图，不是正式标志，也不冒充社团作品。使用系统字体，没有外部字体、素材 CDN 或付费组件依赖。提供跳转正文链接、可见键盘焦点和减少动画偏好支持。

**Logo 尚未完成接入：云端只保留了上一轮生成图，原始上传文件不可读取；按用户要求没有使用生成图代替正式标志。** 导航、首页和页脚目前明确显示“原图待补充”，没有伪造 Logo 或 favicon。请提供原始文件并保存为 `apps/web/src/assets/electronic-club-logo.png`，共享组件会在构建时自动加载并通过圆形容器展示，保持内部比例、图形、颜色和文字不变。`brand.ts` 会将同一原始 PNG 注册为 favicon，不重新绘制。此路径为约定接入位置，**当前文件不存在**。资源作为 Vite 构建资产输出，带哈希缓存地址。

## 本轮验证

- 已执行 `npm ci` 与 `npm run check`（包含 ESLint、TypeScript、3 项后端测试及全工程生产构建）。
- 使用系统 Chromium 检查 1440px、1920px、375px、430px：11 个页面均无横向溢出；测试菜单导航、登录禁用、后台预览切换及页脚真实健康请求。
- 本地验证不等于腾讯云线上部署。部署后须再次刷新详情 URL、检查静态资源以及从前端调用 CloudBase 的真实跨域请求。

## Git 协作

仓库已有 `main`，无需重新初始化。后续改动使用功能分支，提交、推送后创建面向 `main` 的 Pull Request。不要重置远端历史或强制推送。
