# 成员登录记录

超级管理员进入「管理后台 → 权限与安全 → 登录记录」查看姓名、学号、登录时间、IP、设备类型、操作系统与浏览器，支持姓名/学号/IP搜索、结果筛选、北京时间日期范围和服务端分页（默认20、最大50）。设备信息来自 User-Agent 推断，Windows 10/11、部分平板和伪装 UA 无法精确识别；这些字段不参与认证。没有新增运行依赖或付费服务。

## 部署顺序

1. 在已有 011 及前置迁移的 CloudBase PostgreSQL SQL 编辑器执行 `cloudbase/sql/012-login-history.sql`。事务内新增现有审计表索引、安全分页 RPC、匿名化隐私触发器与 `security.logins.read` 权限定义；记录版本 `012-login-history`，可重复执行。不新建角色，不修改已有角色分配、成员、密码或活动内容。
2. 上传本次 `deployment-packages/electronicclub-api.zip` 替换原 `electronicclub-api`，保留入口 `index.main`、原环境变量与 Node18.15/兼容运行时，核对 SHA256。
3. EdgeOne 更新 main 前端并重新构建，原 API 地址不变。SQL → 云函数 → 前端，不能只更换前端。

可选执行 `012-login-history-verify.sql`：backend_allowed 应为 true，浏览器角色 history_allowed 应为 false，并存在新权限和隐私触发器。

## IP 来源配置

默认不需要新增环境变量，优先读取平台提供的 `requestContext.sourceIp`、`requestContext.http.sourceIp` 或 `requestContext.identity.sourceIp`。只保存经过 Node isIP 验证的 IPv4/IPv6。

平台没有提供来源 IP 时，显示「网关未提供」，不会把客户端可随意伪造的 X-Forwarded-For 当成真实 IP。如果当前 CloudBase 网关确实不提供上述 context，必须先确认网关会清除客户端同名头并写入可信来源，再在云函数配置 `LOGIN_TRUSTED_IP_HEADER=x-real-ip` 或 `LOGIN_TRUSTED_IP_HEADER=x-forwarded-for`。后者取可信网关重写后的首个地址。该配置默认关闭，平台 context 始终优先。不要在没有验证网关行为的情况下开启，也不读取客户端自行提交的 JSON IP。

设备、系统、浏览器与 IP 不代表硬件唯一标识或物理位置。反向代理可能提供代理出口 IP，无法据此识别具体个人。

## 权限、历史记录与隐私

- 新接口：`GET /api/login-history?page=1&pageSize=20&search=&outcome=all&from=...&to=...`。outcome 为 all/success/failure/blocked；from 为含起点的 UTC ISO 时间，to 为不含终点的 UTC ISO 时间。页面会把北京时间结束日期转换为次日零点。
- 仅 `security.logins.read` 或超级管理员可访问。现有普通管理员不会因安装迁移而自动获得权限，需在角色管理明确授予。只有原 `audit.read` 的账号仍不能查看 IP/设备。通用 `/api/audit` 始终移除新增网络设备字段。
- 成功登录关联已验证的成员；失败/禁用/凭据过期等记录关联的是被尝试账号，不代表本人操作。查不到成员的失败尝试不保存输入的学号，也不声称已验证身份。限流在同一窗口首次拦截时记录一次，避免大量重复拦截放大日志。
- 复用 `audit_logs` 存储，登录记录通过受限查询联表取得当前姓名、学号，不复制身份资料；不会保存密码、Cookie、会话令牌或完整请求头。UA 截断至512字符并去除控制字符，页面以文本展示。
- 升级前只有成功 UID 的记录仍可关联现有档案，IP/设备标为「未记录」；原脱敏失败记录不能补出账号。部署后产生的新登录才有采集信息。
- 已有「匿名化成员」操作会在同一数据库事务中清除该成员登录记录的 IP、设备和 UA 元数据；查询也会隐藏匿名化成员的身份及设备数据。保留最小审计骨架。仅软删除仍保留审计，可恢复后使用。
- 本次不自动删除旧审计。可根据社团实际制度在私有维护流程制定保留周期，不在网页开放清空登录记录的入口。

## 回滚

优先只恢复上一前端，保留新版云函数的审计字段脱敏；新索引、RPC、权限定义可以保留，不影响旧业务。旧云函数的通用审计接口可能原样返回新增元数据，不能在保留这些数据时直接换回未脱敏的旧 ZIP；必须先把脱敏逻辑回移到回退版本。建议保留隐私触发器，避免匿名化后遗留已采集信息。不应删除审计表、回填伪造设备，或恢复整库覆盖现有成员数据。确需移除 RPC 时，在确认新前端和函数均停止使用后可执行 `DROP FUNCTION public.ec_login_history(jsonb,integer,integer)`；权限定义可保留为未分配。不要回滚超级管理员或账号密码。

## 交付验证

`npm ci`、标准 `npm run check`（SQL 一致性、ESLint、TypeScript、56项测试全部通过且0跳过、前后端生产构建）通过。真实本地 PostgreSQL/RPC 验证迁移重试和已有成员/角色/业务数据保持、浏览器数据库角色无权查询、分页及姓名/学号/IP/结果/日期过滤、普通成员和仅 audit.read 管理员拒绝、新权限授予/撤销即时生效、原审计接口脱敏、限流拦截去重和匿名化物理清理。HTTP 测试验证平台IPv4/IPv6优先、默认不信任转发头、UA限长和浏览器解析。

本机真实浏览器经实际HTTP/受限PG-RPC验证新登录和失败尝试采集、管理查询/筛选/重置、普通成员拒绝、375/1440宽布局以及恶意UA只显示为文本。完整ZIP入口在实际Node18.15通过采集与查询、旧审计脱敏及私有维护检查。未访问或修改生产账号、生产数据库或云函数。

没有新增运行依赖；当前 `npm audit --omit=dev` 为3项moderate，0 high/critical。
