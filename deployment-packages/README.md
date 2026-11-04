# 完整 CloudBase 部署包 · 正文图片与管理界面更新

源码提交 `5dc0c238f08b5ec57fe3a06d5c68a0fc5d557f15`。保留成员、RBAC、活动报名签到、新闻公告、弹窗、论坛及角色成员管理全部 API，新增通用分片图片上传与受控正文图片引用，统一权限分组和管理界面。

下载 [electronicclub-api.zip](electronicclub-api.zip)（GitHub 文件页 Download raw file），校验 [SHA256](electronicclub-api.zip.sha256)。ZIP 根目录直接包含 `index.js`、`package.json`、`package-lock.json`、全部 `node_modules` 运行依赖、私有维护入口、SQL 和部署文档。入口 **index.main**。没有注入真实密码、密钥、生产测试账号或测试图片。

**已有 009/010 的环境升级顺序：**先执行 [011-content-media.sql](../cloudbase/sql/011-content-media.sql)，再上传本 ZIP 替换原 `electronicclub-api`，最后更新 EdgeOne main 前端。保留原环境变量、网关与 Cookie 设置。不要重新初始化数据库、成员或管理员。

- [本次部署、图片 API、预算/清理与回滚](../docs/content-media-deploy.md)
- [本次源码修改文件清单](../docs/content-media-files.md)
- [可选只读核对 SQL](../cloudbase/sql/011-content-media-verify.sql)
- 前置功能：[角色成员管理](../docs/access-workspace-deploy.md) · [论坛](../docs/stage4-deploy.md) · [活动新闻弹窗](../docs/stage3-deploy.md)

新正文/封面允许 3MiB 原图，浏览器自动重编码至50KiB以内，分片上传每片24KiB；每篇正文最多12张。旧图片与原 API 保留。不增加运行依赖或付费对象存储，沿用原32MiB共享图片预算。

验证：`npm ci` 成功，`npm run check` 通过，53项测试全部通过、0跳过，生产构建通过；真实本地 PostgreSQL/RPC 验证迁移可重试、旧业务数据保持、私有授权、并发预算、图片完整性、越权及公开/隐藏控制。浏览器验证活动/新闻/帖子正文插图保存刷新、游客显示、桌面/手机界面。最终完整包使用实际 Node18.15 的 `index.main` 通过三分片上传、发布/隐藏、二进制图片和私有清理。**未执行生产 SQL 或上传 CloudBase 函数。**

`npm audit --omit=dev` 仍有原有10项 moderate，0 high/critical。固定50KiB预算下复杂图可能需要缩小分辨率；细密图建议拆分局部。

大小：12,227,562 字节。SHA-256：

```
c334f976f3e211dbe7d42f631c83eec2fd19990a1c891543f4b3ebdcf214b27c
```
