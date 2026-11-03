# 第三阶段 CloudBase 完整部署包

源码提交 `c3bf71254b27b7735966a028f342cd28c1ae1a82`，功能分支 `feat/stage3-events-content`。**尚未合并 main，生产迁移兼容性尚未验证，不要直接触发现网前端部署。**

下载本目录 [electronicclub-api.zip](electronicclub-api.zip)（GitHub 文件页 Download raw file），上传现有 `electronicclub-api`，入口 `index.main`，运行时 Node.js 18.15。ZIP 根目录含 index.js、package.json、node_modules、diagnose.js、bootstrap.js、SQL 及部署文档；没有注入真实密码或密钥。

先阅读 [部署与回滚说明](../docs/stage3-deploy.md)，保留现有成员与管理员，仅执行 [008-stage3.sql](../cloudbase/sql/008-stage3.sql)。不要重新初始化数据库或管理员。新增权限需要既有超级管理员明确分配。

`npm ci`、`npm run check`（40项全部通过、含真实本地 PostgreSQL）及生产构建通过。浏览器375/430/1440/1920通过。最终部署入口在真实Node18.15、本地临时网关和真实PG service_role下通过登录/Cookie/RBAC/活动/报名/签到/文章/弹窗/Excel及诊断；临时网关不代表腾讯云实测。

生产依赖审计仍有10项 moderate，0 high/critical。Node18已上游EOL。未执行腾讯云上传、生产SQL迁移或EdgeOne正式部署。

大小：12,140,007 字节。SHA-256：

```
4109aab00f70a400205b2b22489956fabeb74600c2c4593f9880fb114b4a6340
```
