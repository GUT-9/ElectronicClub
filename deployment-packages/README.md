# CloudBase 控制台部署包（HTTPS运行通道）

本ZIP对应源码提交 `407d4b619e81f1cb31a8c3550f608eda478b17be`，包含本轮环境ID访问PostgreSQL的HTTPS修复。后续修改源码后需要重新构建同步本目录，ZIP不会自动更新。

点击 `electronicclub-api.zip`，在GitHub文件页选择 **Download raw file**。不要下载整个仓库后直接上传。

- 上传已有 `electronicclub-api`，入口 **index.main**，兼容 **Node.js18.15**。
- 大小：11,931,223 字节。SHA256：`e710a5cc9ceb9a75da2260097d9b0fc29ce50689bf8ff6c6744e4fc01526bca0`；同目录校验文件可独立下载。
- 根目录包含index.js、package.json、node_modules、diagnose.js、bootstrap.js、offline-bootstrap.js、sql/及空值环境变量模板。
- 已通过npm ci、npm run check（29测试含真实本地PG/HTTP事务）、生产构建，并在实际Node18.15下验证登录/Cookie/权限/诊断/重复初始化。
- 默认 **DB_DRIVER=cloudbase-http**，配置环境ID和有正确数据库角色权限的**私有服务端Key**；不需要TCP URL。原生TCP适配器需显式DB_DRIVER=postgres-tcp。

请按 [HTTPS部署步骤](../docs/cloudbase-https-runtime.md) 先执行 `cloudbase/sql/editor-https-install.sql` 并验证私有Key角色授权。包内不含真实密码/Key，不创建正式管理员，也不表示腾讯云已部署或真实连接已验证。默认域名生产限制和跨站Cookie问题仍需单独解决。
