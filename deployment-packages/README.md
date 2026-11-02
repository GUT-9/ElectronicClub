# CloudBase 控制台部署包

本 ZIP 对应源代码提交 `c72ad246decdd80517d2264bfa9e5b753b051c39`，已通过该轮代码检查及本地 PostgreSQL 测试。ZIP不是自动随未来源码提交更新的产物；后续修改后请重新构建并同步本目录。

点击 `electronicclub-api.zip`，在 GitHub 文件页选择 **Download raw file**；不要选择下载整个仓库再直接上传。

上传至已有 `electronicclub-api`，函数入口 `index.main`，兼容 Node.js 18.15。包内已带运行依赖。校验信息见同目录 SHA256 文件。

上传包不会自动配置数据库或创建超级管理员。请按 [部署操作手册](../docs/cloudbase-console-runbook.md) 配置 PostgreSQL、SQL与环境变量；本产物不表示腾讯云部署已验证成功。不包含真实数据库密码或正式管理员密码。
