# CloudBase 控制台部署包（云函数执行身份修复）

本ZIP对应源码提交 `7d6708a826120341138a93295dfb070cb9823bb6`，包含SCF临时执行身份认证修复。仅更新GitHub不会更新云函数，需要重新上传本包。

在GitHub文件页点击 `electronicclub-api.zip` → **Download raw file**。上传已有electronicclub-api，入口 **index.main**，兼容 **Node.js18.15**，包内已带完整依赖。

- 默认DB_DRIVER=cloudbase-http，配置已有环境ID。**无需强制填写CLOUDBASE_APIKEY**；默认读取平台临时执行身份，经官方签名协议换令牌。不要手工加入腾讯云账号的长期根密钥。
- SQL RPC安装、令牌对应的受限SQL角色权限、一次性管理员初始化仍必须完成。BOOTSTRAP_PASSWORD仅提供初始化密码，不自动创建管理员。
- npm ci、npm run check通过，31项测试全部执行，含本地真实PG；完整包在真正Node18.15下通过无API Key的签名换令牌（本地测试网关）、PG登录/Cookie/RBAC/诊断/重复初始化。
- 完整依赖审计22项moderate，0 high/critical。未新增付费服务，未执行云端生产SQL、正式账号创建或函数部署；不把测试结果当作腾讯云真实验证。
- 大小：12,098,141字节；SHA256：`ebd1ac8c77fcdb6dcd34f2cdca437aa3faae41cb63be804294f9ab6112aa3008`。

根目录含index.js、package.json、node_modules、diagnose.js、bootstrap.js、offline-bootstrap.js和sql/，无真实密码/密钥。详细步骤与安全stage/code见 [HTTPS运行文档](../docs/cloudbase-https-runtime.md)。默认域名生产限制与跨站Cookie条件仍需分别处理。
