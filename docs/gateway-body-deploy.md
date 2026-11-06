# 持续INVALID_JSON：网关正文与边缘流块修复

已在隔离环境复现两种会返回相同400的实现缺陷：

1. 云函数按真假值判断isBase64Encoded，字符串"false"也被当成真，导致正常JSON被错误Base64解码。
2. 边缘代理默认每个流块都是Uint8Array。若运行时给ArrayBuffer或DataView，Uint8Array.set会复制空内容，最后转发NUL字节，后端JSON.parse失败。

日志中的INVALID_JSON证明失败发生在正文解析阶段，尚未进入数据库与账号密码验证。但现有日志没有实际事件格式，不能仅凭这两种本地复现认定线上是哪一种。新版本同时修复两处，并增加不包含正文的诊断，以便剩余问题一次定位。

## 本次现有环境操作顺序

1. SQL：无需执行。
2. CloudBase：上传本次完整electronicclub-api.zip，核对SHA256，替换原electronicclub-api，入口仍为index.main，保留现有运行时及变量。
3. EdgeOne：重新部署最新main，包含根目录edge-functions，沿用现有工作目录与构建设置，不能只发布dist。
4. 环境变量：无需修改。两端ECLUB_PROXY_SECRET继续相同4位数字，不重新生成；Cookie、Origin、数据库和七牛配置保持。
5. 核对版本：官网/api/health返回头应同时出现X-EClub-API-Revision: gateway-body-v5和X-EClub-Backend-Revision: gateway-body-v5，再进行一次登录。

如果仍有400，CloudBase日志会新增category为transport的JSON行，记录requestId、stage、bodyType、flagType、flagValue、wireBytes、decodedBytes、wireShape及decodedShape。只需提供该行及Response头，不提供请求正文、账号密码、Cookie或密钥。CloudBase的RetMsg响应头中也会包含Backend-Revision与Body-Error阶段，便于确认实际运行代码。

## 解码和安全边界

- Base64标记仅接受布尔值或语义明确的true/false字符串；false不会进行Base64解码。未知标记明确拒绝。
- 支持原始UTF-8文本、Buffer/ArrayBuffer及视图，以及已经解析的普通JSON数据对象；字节视图严格遵守offset/length，不转发缓冲区外的内容。
- Base64正文先做大小和编码检查，再解码一次；UTF-8严格验证，允许文档开头BOM。JSON只解析一次，不把任意逗号字节串、URL编码或双层字符串猜测成业务对象。
- 维持3.1MB总上限和论坛/图片/资料库64KB限制，编码前后均检查。权限、CSRF、密码和会话逻辑不变。
- 边缘流块转换为正确字节视图再复制，避免ArrayBuffer/DataView零拷贝错误及共享缓冲区重用；仍以UTF-8 JSON文本转发。
- 错误日志只输出固定枚举、大小和请求ID；不记录正文前缀、正文哈希、JSON语法异常原文、任意标记值、密码、Cookie或密钥。

本次是传输兼容性小修，只更新当前云函数包。稳定Linux/运维归档保持原内容，不进行生产迁移。当前执行环境无法访问生产服务或云控制台，线上修复效果需部署后实际确认。

验证：npm ci、npm run check通过，81项测试通过、0失败、0跳过。覆盖布尔/字符串标记、Base64与UTF-8/BOM、缓冲区视图边界、已解析JSON、解码前后预算、无凭据泄漏诊断，以及ArrayBuffer流块和字符串false组合下的完整登录/刷新/RBAC/CSRF/退出。原有PG/HTTPS RPC业务、类型、Lint、构建及Web API边缘函数编译通过。无新增运行依赖，审计仍为既有3项moderate、0 high/critical。
