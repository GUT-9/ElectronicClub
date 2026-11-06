# 成员激活统计与七牛公开资料库

## 本次行为

管理工作台和登录记录页显示正常账号数、成功登录过的人数、已登录且完成初始改密的人数、其余正常账号数。按 UID 去重，当前账号须正常、存在成功登录及改密审计、mustChangePassword=false 才计入完成人数。禁用、删除、匿名化及重置后尚未重新改密的成员不计入。未经历初始改密的预设管理员不会凭空补算。统计由后端聚合，仅超级管理员、members.read 或 security.logins.read 可查。

前台新增 `/resources` 公开资料库，游客搜索、按分类筛选与下载。后台 `/admin/resources` 管理上传、校验、草稿、发布/下架和删除，使用独立的 `resources.manage` 权限，超级管理员默认可用，其他角色通过原角色管理授予；不按职务名称判断。

文件直传七牛，数据库只保存元数据，避免大文件经过 CloudBase 网关。支持 PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、ZIP/7z、UTF-8 TXT/CSV，不支持可执行文件、HTML或SVG。默认单文件50MiB，本应用资料总预算128MiB，可在后端调整。真实格式检查是基础校验，不等于病毒扫描，管理员应确认资料来源。

## 升级顺序

1. 在已有012及前置版本的 CloudBase PostgreSQL SQL 编辑器执行 `cloudbase/sql/013-member-stats-resources.sql`。脚本使用事务和版本记录，可重复执行；新增资料元数据表、索引、受限统计/分页RPC和权限定义，扩展原RPC白名单。不会重建成员、角色或密码，不清空旧数据。
2. 上传最新 `deployment-packages/electronicclub-api.zip` 替换原函数，入口仍为 `index.main`，保留原环境变量。核对 SHA256。Node18.15/兼容运行时。
3. 在原云函数配置七牛环境变量，见下节。
4. 配置七牛空间 CORS，然后 EdgeOne 更新 main 前端。仓库根目录 `edgeone.json` 已为 `/resources` 补上到 `/index.html` 的 SPA 回退；`/admin/resources` 由现有 `/admin/*` 覆盖。需要重新构建部署，使路由配置生效；若控制台覆盖了仓库配置，需同步这条重写。部署后直接打开并刷新 `/resources` 核对，不能仅用站内点击测试。

`013-member-stats-resources-verify.sql` 为可选只读核对。没有配置七牛时成员统计仍可用，管理页会显示“存储待配置”，不会伪造上传成功。本交付不代表已执行生产SQL或操作七牛空间。

## 按截图配置七牛

截图的空间是 `edwell-k12`，区域为华东浙江（z0），公开访问，HTTPS CDN域名为 `oss.gut9.cn`。可以复用这个现有空间和域名，不需要再开通一个存储产品。

在七牛「个人中心 → 密钥管理」取得有对应空间操作权限的 AccessKey / SecretKey，仅填入 **CloudBase 云函数后端环境变量**：

```dotenv
QINIU_ACCESS_KEY=你的七牛AccessKey
QINIU_SECRET_KEY=你的七牛SecretKey
QINIU_BUCKET=edwell-k12
QINIU_DOWNLOAD_DOMAIN=https://oss.gut9.cn
```

不要发到聊天、提交Git、放入VITE变量或网页代码。优先使用仅授权该空间和本应用目录操作的专用密钥。原 CloudBase 身份认证保持不变，不需要新的 CLOUDBASE_APIKEY。

华东默认表单上传地址 `https://upload.qiniup.com`，无需填写上传地址。不要把截图的 S3 Endpoint 填作这个表单上传地址。本实现使用七牛原生上传/RS管理API。如果换区域，再按实际空间填写可选 `QINIU_UPLOAD_URL`（受信任的七牛HTTPS上传域名）。

可选预算：

```dotenv
# 本应用保留/已上传文件的总字节预算，默认128MiB，不含空间原有文件
QINIU_RESOURCE_BUDGET_BYTES=134217728
# 默认50MiB，最大支持100MiB；总预算须不小于单文件上限
QINIU_RESOURCE_MAX_BYTES=52428800
```

这些预算不是七牛免费剩余额度。截图只能确认空间和域名已配置，不能确认账户套餐覆盖的存储、下载流量、CDN/HTTPS请求与超额费用。请在七牛权益/计费页核对并设置费用提醒；公开下载流量不会由本应用存储预算限制。

### 跨域设置

七牛空间 → 空间设置 → 跨域设置，允许网站源 `https://eclub.gut9.cn`：

- 方法允许 POST（表单上传）；按控制台需要允许 OPTIONS 预检。
- 允许请求头 `Content-Type`（或七牛控制台对应的通配配置）。
- 如使用自定义响应头，可暴露 `X-Reqid`；本实现不依赖该响应头。
- 浏览器上传不携带站点 Cookie，凭证在表单 token 字段中，不能使用 allow-credentials 来暴露服务端密钥。

直接上传使用的是七牛上传域名，下载使用的是 `oss.gut9.cn`。保持域名HTTPS证书有效；若开启 Referer 防盗链，还需允许前台下载和服务端校验的空Referer请求，否则可能校验失败。资料公开链接不是权限控制，CORS也不是文件保密机制。

## 安全与配额

- 上传令牌有效期10分钟，精确限定 `空间:对象key`、禁止覆盖、限定真实大小、检测MIME并限制资料MIME范围。
- 对象key由服务端生成，仅位于 `electronicclub/resources/v1/<UUID>.<扩展名>`。不列举、搬动或删除空间原有的80个文件；切换空间后旧资料不会被错误地从新空间删除。
- 完成上传时后端通过签名RS接口确认文件大小/哈希，并从HTTPS下载域名最多读取8KiB头部校验格式。验证通过后仅为草稿，管理员明确发布后才出现在网站资料库。
- 公共空间中的草稿仍是公开对象：草稿/下架只控制网站列表，不能把文件变成内部资料。不要上传成员名单、账号密码等敏感文件。
- 每名管理员每10分钟最多启动10次上传；事务内预留总预算，未完成上传也占预算，避免并发超额。
- 删除先下架，再等待上传令牌过期加30秒后删除七牛对象并归还预算，防止仍有效的令牌重建已删除对象。待清理项可稍后点击“重试清理”。实际删除失败不释放预算，避免误报空闲空间。
- 已公开文件的CDN缓存可能在源文件删除后短时可用，必要时在七牛刷新缓存。下架不是撤销已公开内容。
- 原私有 `forum-maintenance.js --cleanup-staged` 现在同时清理令牌已过期的待删除资料以及超过24小时的未完成上传，每批20份。没有配置七牛时会跳过这一部分，不影响现有图片清理。此命令只应在获授权的私有终端使用，没有网页清空接口。

若上传后浏览器提示网络/CORS错误，文件可能已到达七牛：刷新后台，对“待上传/校验”项点击“校验上传”，不要立即重复新建。校验失败检查域名HTTPS、下载防盗链和空间/密钥权限。

## API

- GET `/api/members/stats`：受限成员统计，无成员身份明细。
- GET `/api/resources`：公开已发布列表，page/pageSize/search/category；pageSize最大50。
- GET `/api/resources?admin=true`：需resources.manage，可附status筛选。
- GET `/api/resources/config`：管理员查看是否已配置、空间/域名和预算，不返回长期密钥。
- POST `/api/resources/uploads`：标题、说明、分类、originalName、size，管理员获得单对象限时表单令牌。
- POST `/api/resources/:id/complete`：后端核验，成功后为草稿。
- POST `/api/resources/:id/update`：编辑元数据与draft/published状态。
- POST `/api/resources/:id/delete`：下架并安全删除/排队清理。
- GET `/api/resources/:id/download`：仅已发布资料返回HTTPS公开下载地址，不代理大文件。

所有写操作沿用登录、CSRF与RBAC，并写入审计。七牛网络请求在原数据库事务之外，避免乐观重试重复触发外部副作用，最终状态和预算通过事务重新检查。

## 回滚与验证边界

优先只回退前端并保留新后端及表，不删除已上传的文件或元数据。统计是现有数据聚合，不存在用户状态回滚。不要DROP资料表、恢复整库或重新初始化管理员，否则可能丢失对象与预算关联。已有待清理任务应继续使用新版私有清理入口处理。

本任务没有用户七牛密钥，未在真实空间上传或删除文件。七牛签名、大小/格式检查使用可重复的HTTP替身测试；本地真实PostgreSQL/RPC与浏览器验证统计、直传界面、校验/发布/公开下载与权限隔离。这些检查不等于真实七牛账号已连通。实际启用需要上述后端密钥、空间及CORS配置。

实现参考七牛官方开源SDK的 [上传策略与下载签名](https://github.com/qiniu/nodejs-sdk/blob/master/qiniu/storage/rs.js)，使用Node内置HMAC-SHA1，不新增运行依赖。

## 本次交付检查

`npm ci` 成功，`npm run check` 通过：SQL生成一致性、ESLint、TypeScript、58项测试全部通过且0跳过、前后端生产构建。真实本地PostgreSQL验证013重复执行、已有成员/角色/业务数据保持、浏览器数据库角色无权直接访问、统计去重及重置/禁用排除、资料发布与权限、并发预算、删除等待与清理，以及原有业务回归。七牛HMAC签名、单key策略、大小/MIME/文件头校验使用HTTP替身，并核对官方SDK默认管理域名 `rs.qiniu.com` 及V1签名规则。

浏览器通过本机HTTP/受限PG-RPC完成管理员上传/校验/发布、游客下载、普通成员拒绝、搜索与空列表，以及375/1024/1440宽度布局；七牛上传与下载网络明确使用测试替身，没有写入真实空间。完整ZIP使用实际Node18.15入口验证统计、签名上传策略、校验、公开列表/下载及待删除流程，仍使用本地SQL和七牛HTTP替身。

未新增运行依赖；当前 `npm audit --omit=dev` 为3项moderate，0 high/critical。完整ZIP和SHA256位于deployment-packages。
