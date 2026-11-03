# CloudBase 控制台部署包：现有service_role安装适配

本ZIP对应源码提交 `c201bb2deb4d2a5770ead12656659304b0fa7de0`。GitHub文件页点击electronicclub-api.zip → **Download raw file**。

- 上传入口index.main，支持Node18.15，根目录含完整node_modules、诊断/私有初始化脚本及sql/。
- **本轮仅修改SQL和运维工具。已有函数若已到http_rpc阶段，无需为本轮SQL角色修复重新上传；先执行新版安装SQL。**
- sql/editor-https-install.sql复用平台现有service_role，不创建electronicclub_api，不需要CREATEROLE；一份事务包括表、索引、服务角色授权和RPC。不得改为向anon/authenticated/PUBLIC开放数据。
- npm ci、npm run check（34项测试全部执行，含真实PG的NOCREATEROLE账号安装、服务角色登录、匿名隔离、保留数据和回滚）及生产构建通过。
- 当前云函数默认复用SCF临时执行身份。SQL已安装仍需验证令牌对应的SQL角色，以及完成私有管理员初始化。BOOTSTRAP_PASSWORD不会自动建账号。
- 没有执行CloudBase生产SQL、正式账号创建或函数上传；本地测试不代表腾讯云上线成功。完整依赖仍有此前记录的moderate告警，本轮没有新增依赖。
- ZIP大小：12,104,732字节；SHA256：`0cdcc96c7e33240eae6d1ca9ab17b94a1389a483fc9cc9200fbb15d901e1c69e`。

原生PG自建角色的003/004/005仅保留兼容用途；当前托管环境优先用新完整安装脚本，或已有表时用006-managed-service-role.sql。操作说明见[HTTPS部署文档](../docs/cloudbase-https-runtime.md)。
