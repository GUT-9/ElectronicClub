# 完整 CloudBase 部署包 · 成员统计与七牛资料库

源码提交 `03156407754e7cb5adda6db38e48acb0f213d096`。保留之前所有API，新增登录改密人数聚合与公开资料库，支持管理员七牛直传、校验、发布/下架和安全删除。

下载 [electronicclub-api.zip](electronicclub-api.zip) 并核对 [SHA256](electronicclub-api.zip.sha256)。根目录直接含 index.js、package.json、package-lock.json、全部 node_modules 运行依赖、全部 SQL、私有维护及部署文档，入口 **index.main**。不含真实凭据或生产测试数据。

**已有012升级顺序：**执行 [013-member-stats-resources.sql](../cloudbase/sql/013-member-stats-resources.sql) → 替换原electronicclub-api ZIP并配置七牛后端环境变量 → 七牛CORS → EdgeOne更新main。不重建成员或角色、不重置密码。

- [七牛配置、免费额度说明、完整API及回滚](../docs/resources-deploy.md)
- [可选只读核对SQL](../cloudbase/sql/013-member-stats-resources-verify.sql)
- 前置：[登录记录](../docs/login-history-deploy.md) · [正文图片](../docs/content-media-deploy.md) · [论坛](../docs/stage4-deploy.md)

截图空间 `edwell-k12` 与HTTPS域名 `oss.gut9.cn` 可以复用。实际上传还需要在云函数中填写 QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET、QINIU_DOWNLOAD_DOMAIN，并允许前台源上传跨域。密钥不写前端、不发聊天、不提交Git。本应用仅操作electronicclub/resources/v1目录，不移动空间原有资料。默认单文件50MiB、应用预算128MiB；这些限制不代表七牛免费套餐额度，也不限制公开下载流量。

统计按当前正常账号去重，同时具备成功登录、改密审计且当前无需改密才计入；禁用/删除、匿名化及重置后待改密排除。超级管理员、members.read或security.logins.read可查。资料管理需resources.manage，游客只见已发布条目。

验证：npm ci与npm run check通过，58项测试全部通过、0跳过，SQL/ESLint/TypeScript和生产构建通过；真实本地PG/RPC验证旧数据保持、迁移重复、受限权限、统计去重、并发预算及清理。浏览器验证直传界面、发布/游客下载、普通成员禁止管理与375/1024/1440布局。最终ZIP的实际Node18.15入口通过完整流程。**七牛网络使用明确测试替身，没有真实用户密钥，未执行生产SQL、上传云函数或写入真实七牛空间。**

无新增运行依赖；当前audit为3 moderate，0 high/critical。实际启用需按文档配置密钥、域名和CORS；免费存储/流量/CDN权益以七牛账户套餐为准。

大小：12,272,832 字节。SHA-256：

```
6d2977ac637431b19780f50fb5bd68f268d1b98ab1a1f05cffeddd665c56bed2
```
