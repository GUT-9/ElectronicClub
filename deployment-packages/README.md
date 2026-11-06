# 当前云环境：代理密钥与JSON正文兼容更新

云函数源码提交 `3abf2e30f5f66db5f0251c06910c739fb0d1346b`。本次修复EdgeOne与CloudBase读取代理密钥时的复制格式差异，保留前一个JSON UTF-8文本传输补丁、现有登录、RBAC、成员、导入、活动报名/签到、论坛、公告、图片及七牛资料库。

## 本次操作顺序

1. **SQL：无需执行新SQL。** 原数据库、账号和迁移保持。
2. **CloudBase：上传本次[完整ZIP](electronicclub-api.zip)，核对[SHA256](electronicclub-api.zip.sha256)。** 替换原electronicclub-api函数代码，入口仍为index.main，保留原运行时及已有变量。
3. **变量：两端ECLUB_PROXY_SECRET使用之前生成的相同值，不重新生成。** EdgeOne函数运行变量与CloudBase原函数环境变量的“值”推荐只填完整64位hex字符，不带变量名、命令或Markdown标记。新代码两端统一兼容复制空白、配对引号和明确赋值前缀；保留大小写。原ALLOWED_ORIGIN、COOKIE_SECURE、COOKIE_SAMESITE、数据库和七牛变量继续保留。
4. **EdgeOne：从最新main重新部署网页与根目录edge-functions。** 保留仓库根工作目录、npm ci、npm run build -w @electronic-club/web、apps/web/dist、Node22。不能只上传dist。旧VITE_API_BASE_URL不再控制浏览器请求，默认上游已沿用现有网关，无需新设API_UPSTREAM_ORIGIN。
5. **验收：** 官网/api/health响应头应为X-EClub-API-Revision: secret-text-v3，再验证登录、刷新和退出，以及授权管理员的登录IP。当前执行环境没有生产访问/控制台能力，不能将本地测试当作已完成云发布。

[本次密钥格式修复说明](../docs/proxy-secret-config-fix.md) · [完整同源接入说明](../docs/same-origin-api.md)。API转发密钥格式错误发生在EdgeOne请求CloudBase之前；旧INVALID_JSON日志不能证明新部署的JSON文本传输仍失败。

## 云函数文件

ZIP根目录直接包含index.js、package.json、package-lock.json、全部node_modules运行依赖、原SQL迁移及部署文档。入口index.main。大小 12,308,050 字节；SHA-256：

```
574848eb12b8851e930f8bac40d3e5063311e034f574160d3c7bdc5fd2295727
```

包中不含真实密码、密钥或生产成员数据。服务端只信任验证通过的签名元数据，不接受用户伪造IP。配置错误提示不回显密钥；缺失/无效签名仍回退网关IP，不能假称成员真实IP有效。

## 验证及其他交付

npm ci、npm run check通过，74项测试通过、0失败、0跳过，含配置清理、两端复制形式互通、原有HMAC/JSON/会话/RBAC/CSRF及真实PG/HTTPS RPC业务回归、类型、Lint、生产构建和边缘函数Web API编译。运行依赖未新增；npm audit --omit=dev仍为既有3项moderate、0 high/critical，退出码1。

从最终ZIP解压后，实际Node18.15.0验证入口加载、带空白/引号/赋值前缀的服务端密钥、签名及篡改拒绝、Secure/HttpOnly/Lax Cookie头通过；不连接生产数据库。

本次属于小修，稳定Linux与运维归档内容和时间戳保持，不执行生产数据库/服务器迁移。组件摘要与来源以[release-state.json](release-state.json)为准。服务器迁移另见[说明](../docs/linux-server.md)，待用户要求时交付操作。

原功能部署入口：[活动审核与负责人015](../docs/event-operations-deploy.md) · [成员彻底删除014](../docs/member-purge-deploy.md) · [七牛资料库013](../docs/resources-deploy.md) · [登录记录012](../docs/login-history-deploy.md) · [正文图片011](../docs/content-media-deploy.md) · [论坛009](../docs/stage4-deploy.md)。
