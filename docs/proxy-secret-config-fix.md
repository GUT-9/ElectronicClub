# API转发密钥配置报错修复

“API转发密钥配置有误”由EdgeOne代理在请求CloudBase前返回，表示EdgeOne运行时读到的ECLUB_PROXY_SECRET没有通过格式检查，不是云函数JSON解析错误。旧日志里的INVALID_JSON只证明当时云函数收到的正文不可解析，不能据此判断新部署的JSON文本修复是否生效。

## 本次现有云环境升级

1. SQL：无需执行新SQL。
2. CloudBase：上传本次完整electronicclub-api.zip替换原函数，入口仍为index.main，保留已有变量。新包统一了服务端与边缘端的密钥读取规则。
3. 环境变量：两端均使用ECLUB_PROXY_SECRET，推荐“值”只填之前生成的同一串64位hex字符，不重新生成密钥、不加VITE前缀。不要将变量名、等号或Markdown标记填进值。若重填规范值，旧代理也应能通过格式校验。
4. EdgeOne：从最新main重新部署，包含根目录edge-functions，沿用现有安装、构建、输出目录及上游配置。
5. 响应头X-EClub-API-Revision应为secret-text-v3。再验证登录、刷新和退出，以及授权管理员的登录IP记录。未取得生产访问/控制台能力，线上效果须实际部署后核对。

## 兼容处理

EdgeOne与CloudBase共用normalizeProxySecret：清理配置空白（含CRLF、复制换行和BOM）、一层配对引号和明确的ECLUB_PROXY_SECRET=赋值前缀，再校验64位十六进制内容。保留字母大小写，避免改变已有效的HMAC密钥字节。不会读取请求里的“密钥”，也不会接受截断、非hex、错误变量前缀或不配对引号。

密钥缺失时仍沿用原有网关IP回退；配置损坏则EdgeOne返回明确的API_PROXY_SECRET_FORMAT和变量位置，不回显密钥、不静默宣称真实IP有效。保持Cookie、会话、RBAC和60秒签名窗口；保留前一个补丁的UTF-8 JSON文本转发。

本次是兼容性小修，只更新CloudBase运行包；不提升重大更新版本或刷新稳定Linux/运维包。

验证：npm ci与npm run check通过，74项测试通过、0失败、0跳过；包括配置规范化、两端不同复制形式的HMAC互通、错误密钥不泄漏、JSON UTF-8正文、原有登录/RBAC和真实PostgreSQL/HTTPS RPC回归，另有类型、Lint、构建及边缘函数Web API编译。无新增运行依赖。
