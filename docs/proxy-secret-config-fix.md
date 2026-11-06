# API转发密钥配置报错修复

“API转发密钥配置有误”由EdgeOne代理在请求CloudBase前返回，表示EdgeOne运行时读到的ECLUB_PROXY_SECRET没有通过格式检查，不是云函数JSON解析错误。旧日志里的INVALID_JSON只证明当时云函数收到的正文不可解析，不能据此判断新部署的JSON文本修复是否生效。

## 本次现有云环境升级

1. SQL：无需执行新SQL。
2. CloudBase：上传本次完整electronicclub-api.zip替换原函数，入口仍为index.main，保留已有变量。新包统一了服务端与边缘端的密钥读取规则。
3. 环境变量：按用户要求，两端ECLUB_PROXY_SECRET现在可填写相同4位数字（例如1234），前导零保留。先更新两端代码再改值；旧64位hex值继续兼容。值不加VITE前缀，不含变量名或Markdown标记。
4. EdgeOne：从最新main重新部署，包含根目录edge-functions，沿用现有安装、构建、输出目录及上游配置。
5. 响应头X-EClub-API-Revision应为four-digit-v4。再验证登录、刷新和退出。未取得生产访问/控制台能力，线上效果须实际部署后核对。

## 兼容处理

EdgeOne与CloudBase共用normalizeProxySecret：清理配置空白（含CRLF、复制换行和BOM）、一层配对引号和明确的ECLUB_PROXY_SECRET=赋值前缀，再校验4位ASCII数字；旧64位hex配置仍兼容，保留其大小写。不会读取请求里的“密钥”，也不会接受不符合格式、错误变量前缀或不配对引号的配置。

4位值易被猜到，只用于用户选择的便捷代理配置，不提供可靠的IP防伪保证。账号密码、Cookie会话及RBAC继续独立验证，不能用4位值替代成员登录或权限检查。密钥一致性验证可拒绝意外不匹配，不能据此声称4位值足以防止有意伪造IP记录。

密钥缺失时仍沿用原有网关IP回退；配置损坏则EdgeOne返回明确的API_PROXY_SECRET_FORMAT和变量位置，不回显密钥、不静默宣称真实IP有效。保持Cookie、会话、RBAC和60秒签名窗口；保留前一个补丁的UTF-8 JSON文本转发。

本次是兼容性小修，只更新CloudBase运行包；不提升重大更新版本或刷新稳定Linux/运维包。

验证：npm ci与npm run check通过，75项测试通过、0失败、0跳过；包括4位数字及前导零、两端不同值拒绝验签、旧配置兼容、复制规范化、JSON UTF-8正文、4位配置下的完整登录/会话/RBAC/退出及真实PostgreSQL/HTTPS RPC回归，另有类型、Lint、构建及边缘函数Web API编译。无新增运行依赖。
