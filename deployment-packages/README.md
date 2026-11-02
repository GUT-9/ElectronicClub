# CloudBase 控制台部署包（云函数执行身份修复）

本ZIP对应源码提交 `680641f7fb354fd1e3b44c7063e09971a432df48`，包含SCF临时身份认证及数据库上游错误安全诊断。仅更新GitHub不会更新云函数，需要重新上传本包。

在GitHub文件页点击 `electronicclub-api.zip` → **Download raw file**。上传已有electronicclub-api，入口 **index.main**，兼容 **Node.js18.15**，包内已带完整依赖。

- 默认DB_DRIVER=cloudbase-http，配置已有环境ID。**无需强制填写CLOUDBASE_APIKEY**；默认读取平台临时执行身份，经官方签名协议换令牌。不要手工加入腾讯云账号的长期根密钥。
- SQL RPC安装、令牌对应的受限SQL角色权限、一次性管理员初始化仍必须完成。BOOTSTRAP_PASSWORD仅提供初始化密码，不自动创建管理员。
- npm ci、npm run check通过，32项测试全部执行，含本地真实PG；完整包在真正Node18.15下通过无API Key的签名换令牌（本地测试网关）、PG登录/Cookie/RBAC/诊断/重复初始化。
- 完整依赖审计22项moderate，0 high/critical。未新增付费服务，未执行云端生产SQL、正式账号创建或函数部署；不把测试结果当作腾讯云真实验证。
- 大小：12,102,271字节；SHA256：`90151adbb5c96fefe061eea0ed331161f2f40120bc2e7c86679f63573c3d9a23`。

根目录含index.js、package.json、node_modules、diagnose.js、bootstrap.js、offline-bootstrap.js和sql/，无真实密码/密钥。详细步骤与安全stage/code见 [HTTPS运行文档](../docs/cloudbase-https-runtime.md)。默认域名生产限制与跨站Cookie条件仍需分别处理。

本版补充上游HTTP状态、允许列表错误码及请求ID诊断。先运行只读sql/editor-login-check.sql确认安装状态；表和RPC存在但仍失败时再用新包取安全日志。没有输出原始错误消息、密码、Token，也没有将云端RPC失败报告为已修复。
