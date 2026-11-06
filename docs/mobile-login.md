# Safari、QQ 与微信的登录会话

如果显示“账号密码已验证，但浏览器未能恢复登录会话”，表示登录接口成功，紧接的 `/api/auth/me` 请求却返回401。常见原因是会话 Cookie 没有被保存或发送；网关未透传 Cookie、登录与会话检查指向不同环境、服务端会话失效也可能产生同样现象。不能仅凭截图认定用户密码或手机设置有问题。

## Cookie 是什么

这是浏览器自动保存并随请求发送的登录凭证。本项目的凭证是随机会话标识，密码不会放进 Cookie；数据库仅保存标识的摘要。前端请求已使用 `credentials: 'include'`，但浏览器隐私策略仍可拒绝跨站 Cookie。

| 设置 | 本项目的含义与要求 |
| --- | --- |
| `Secure` | 仅经 HTTPS 发送；生产保留 `COOKIE_SECURE=true`。 |
| `HttpOnly` | 页面 JavaScript 不能读取凭证，防止前端脚本直接窃取。 |
| `SameSite=Lax` | 默认设置，适合同源或同站点 HTTPS API。 |
| `SameSite=None` | 跨站请求需要，同时必须 `Secure`；仍不能绕过 Safari 的第三方 Cookie 限制。 |
| `Path=/` | 整个 API 可使用，同源代理必须保留。 |
| 无 `Domain` | Cookie 只属于响应主机；`__Host-ec-session` 名称要求 HTTPS、`Path=/` 且不能添加 `Domain`。 |
| `Max-Age=28800` | 会话有效期8小时；登出时同时撤销服务端会话并清除 Cookie。 |

`eclub.gut9.cn` 与 `*.tcloudbase.com` 是不同站点。在两者之间执行 fetch 属于跨站调用。Safari 的跨站跟踪防护、部分 QQ/微信 WebView 的 Cookie 策略可能让登录接口成功后仍无法恢复会话。CORS 允许来源、`credentials: 'include'` 和 `SameSite=None` 都不会强制浏览器接受第三方 Cookie。

## 推荐部署方式

1. 同源入口：网页与 API 都通过 `https://eclub.gut9.cn`，后端放在 `/api`。确认代理保留请求 Cookie、响应 Set-Cookie、Origin、状态码和二进制内容，并且不缓存登录/API 响应。新前端固定使用此入口，不再读取 `VITE_API_BASE_URL`；后端保留 `ALLOWED_ORIGIN=https://eclub.gut9.cn`、`COOKIE_SECURE=true`、`COOKIE_SAMESITE=lax`。网页与真实 `/api` 转发必须一同部署，静态 SPA 回退不能代替 API 代理。
2. 同站点域名：使用平台支持的正式 HTTPS API 域名，例如 `https://api.gut9.cn`，前端构建变量指向这个源地址；后端仍允许精确网页 Origin，使用 Secure/Lax Cookie。跨源请求仍需正确 CORS，但不再依赖第三方站点 Cookie。需要实际配置网关域名、DNS 与证书，仅创建 DNS 别名或修改 Cookie Domain 不够。

最新代码的 EdgeOne 边缘函数与 Linux Caddy 都实现第一种方式。前端始终访问同源 `/api`，旧 `VITE_API_BASE_URL` 不再控制请求；根目录边缘函数必须随前端一起部署，见[同源升级步骤](same-origin-api.md)。只部署旧版前端或静态 dist 不会自动修复当前云站。平台函数能力、额度和上游使用限制仍需实际账户确认，不通过代理规避默认网关使用限制。

不要求成员关闭 Safari 的“防止跨站跟踪”，也不建议改用 localStorage 保存登录令牌。用户若自行禁用了所有 Cookie，需要允许本站必要的会话 Cookie；这与关闭跨站隐私防护是两回事。QQ/微信中可以先“在浏览器打开”，但如果 API 仍跨站，Safari 也可能失败。

## 管理员核对

在授权设备上检查登录 POST 与随后的 `/api/auth/me`：

- 登录响应是否有 `Set-Cookie`，是否被浏览器标记为拒绝保存；登录不是只有 HTTP200，还需业务响应 success=true。
- `/auth/me` 的实际 URL 是否与登录使用同一个 API；请求是否带 `__Host-ec-session`。不要将 Cookie 值、密码、请求 HAR 或含凭证截图公开发出。
- Cookie 缺失：检查第三方 Cookie 策略、HTTPS、SameSite 及代理透传。
- Cookie 已发送仍401：检查后端环境、数据库会话记录、到期/撤销及网关是否丢失 Cookie；不要直接把401当成浏览器拦截。
- 采用同站点 API 时，跨源 CORS 必须精确允许网页源并允许 credentials，不能使用 `*`；现有 Origin/JSON/请求头 CSRF 校验继续保留。

部署新前端与边缘函数后，分别用 iPhone Safari 与真实 QQ/微信客户端验证登录、刷新、改密、退出和重新登录；修改 User-Agent 的桌面测试不能替代这些验收。隔离环境验证同源 Cookie 不代表现有云生产环境已完成实机验收。
