# 完整 CloudBase 部署包 · 成员彻底删除权限

源码提交 `36c8d6b2d306f5190b2451d7e969ae02ed0e0e0b`。保留已有成员登录、RBAC、活动、签到、论坛、正文图片、登录记录、成员统计和七牛公开资料库，新增独立 `members.purge` 权限及受控彻底删除接口。

下载 [electronicclub-api.zip](electronicclub-api.zip)，核对 [SHA256](electronicclub-api.zip.sha256)。ZIP根目录直接包含 `index.js`、`package.json`、`package-lock.json`、全部 `node_modules` 运行依赖、SQL及部署/私有维护文件，入口 **index.main**。不含真实密钥或生产成员资料。

已有013环境升级：执行 [014-member-purge.sql](../cloudbase/sql/014-member-purge.sql) → 替换原函数ZIP并保留环境变量 → EdgeOne部署最新main。无需新增环境变量、密钥或收费服务。迁移可重复执行，只安装权限、触发器及能力标记，不删除任何现有账号，不修改既有角色分配或密码。

- [部署、权限配置、删除范围、API及回滚说明](../docs/member-purge-deploy.md)
- [可选只读核对SQL](../cloudbase/sql/014-member-purge-verify.sql)
- 前置功能：[七牛资料库与成员统计](../docs/resources-deploy.md) · [登录记录](../docs/login-history-deploy.md) · [正文图片](../docs/content-media-deploy.md) · [论坛](../docs/stage4-deploy.md)

角色与权限的「账号与安全」分组新增「彻底删除成员（不可恢复）」，超级管理员默认可用，其他角色需明确授权。操作成员详情还需成员查询权限。先软删除，再输入目标学号确认（匿名化成员输入UID）。只允许删除没有业务关联的已软删除账号；存在帖子、报名、签到、资料、图片等历史时拒绝删除并提示匿名化。拒绝后账号、角色计数和历史记录全部保持。学号释放后重新创建会生成新UID。

清理成员、凭据、会话、学号索引、角色关联、已完成隐私任务及对应导入身份快照，移除可关联到该UID的登录IP/设备元数据，保留最小审计骨架和删除操作。已导出的文件和备份不在操作范围。当前账号、超级管理员和待完成隐私清理账号有独立保护。不会级联清空业务内容，数据库触发器也检查未来外键。

验证：`npm ci`成功；`npm run check`通过，**61项测试全部通过，0跳过**，包含SQL一致性、ESLint、类型与前后端生产构建。本地真实PG/RPC验证迁移重复、旧数据保持、越权拒绝、授权即时生效、清理与学号复用、角色计数、关联拦截回滚、未来CASCADE外键保护及并发重复删除，已有功能回归通过。浏览器验证确认输入、实际删除、完成提示、权限查询和375/1440布局。

从最终ZIP解压后使用**实际Node18.15入口**和受限本地PG/RPC验证新权限目录、登录、游客拒绝、软删除前置、彻底删除、404、学号复用、业务关联409及原管理员保持。未执行生产迁移、上传生产函数或删除真实成员。

无新增运行依赖；`npm audit --omit=dev`仍报告既有3项moderate、0 high/critical，审计退出码1。七牛环境变量与配置沿用原资料库说明。

大小：12,286,663字节。SHA-256：

```
3444eb7cac11488a5dc5edc7ab6f6df9ab99b3273c81eb877286a69e8bfa9d87
```
