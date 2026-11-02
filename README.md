# ElectronicClub · 电子俱乐部

电子俱乐部成立于1991年，挂靠物理与电子科学学院，以培养电子技术基本技能、开展电子设计与创新实践、通过学科竞赛促进学习为宗旨。本项目不包含未经确认的现任成员或指导老师资料。

这是第一阶段工程：提供官网首页、健康检查、共享 API 类型和可复现的开发与构建流程。论坛、报名、Excel 导入、RBAC 和数据库读写留待后续开发。

## 开发环境

使用 Node.js 22.12+（推荐 Node 22 LTS，当前云端 Node 24 也已验证）和 npm 10+，在仓库根目录执行：

```bash
npm ci
npm run dev:api
# 另一个终端，仍在仓库根目录
npm run dev
```

前端默认端口 5173，后端默认端口 3001。Vite 将 `/api` 转发到本地后端。访问首页后点击“检查连接”，成功显示“后端连接正常”。默认不需要密钥、不需要 CloudBase 账号，也不启动数据库。

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
    src/views/         首页
  functions/           Node.js + TypeScript 云函数
    src/index.ts       CloudBase 入口 main，HTTP 请求分发
    src/local.ts       本地 HTTP 适配器
packages/shared/       前后端共享 API 类型、路径常量
tests/                云函数协议、错误路由与 CORS 测试
.github/workflows/     GitHub Actions CI
```

前端由 Vue Router 管理页面，使用 Pinia 保存健康检查状态，Element Plus 提供按钮和状态组件。后端类型引用在编译时擦除，当前云函数无运行时第三方依赖。

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
4. 当前仅有 `/` 页面。后续新增 Vue Router history 页面时，在平台配置 SPA 回退到 `/index.html`，保留真实静态资源路径。
5. 在部署后的首页点击“检查连接”，验证真实前端到 CloudBase 的请求和 CORS。云部署需要腾讯云账号、环境与域名，本初始化不创建收费资源，也不声称已部署。

## API

`GET /api/health` → HTTP 200：

```json
{"success":true,"data":{"status":"ok","service":"ElectronicClub API","timestamp":"2026-01-01T00:00:00.000Z"}}
```

时间为服务端当前 ISO 时间，示例仅表示格式。未知路径返回 404，已知路径的不支持方法返回 405；错误体为 `{"success":false,"error":{"code":"...","message":"..."}}`。`OPTIONS /api/health` 返回 204，匹配 `ALLOWED_ORIGIN` 时带允许来源头；未配置时不允许浏览器跨域读取。本地 Vite 代理属于同源请求。

## 空远端仓库的首次提交

当前任务会创建本地提交并尝试推送。只有实际成功的命令输出才说明远端已初始化。若云端缺少推送权限，可在有权限的终端进入包含本次提交的工作区执行：

```bash
git branch -M main
git push -u origin main
```

如果远端已出现其他提交，先 fetch 并检查历史，不要强制推送。空仓库必须先有默认分支才能常规创建 PR；首次提交直接进入 main 时没有可比较的初始化 PR。后续改动可用 `git switch -c feature/主题`，提交、推送后通过 GitHub 创建指向 main 的 PR。
