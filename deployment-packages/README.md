# 当前云环境：持续INVALID_JSON传输修复

源码提交 `56090f97aaebad10dc37389b3ca9036c8c207e86`。本次处理云函数字符串false编码标记误判、边缘ArrayBuffer/DataView流块被错误拼成NUL字节的问题，保留现有4位配置、登录、RBAC、活动、论坛、公告和资料库。[详细修复与诊断](../docs/gateway-body-deploy.md)。

## 本次操作顺序

1. **SQL：无需执行。**
2. **CloudBase：上传[新完整ZIP](electronicclub-api.zip)，核对[SHA256](electronicclub-api.zip.sha256)。** 替换原electronicclub-api代码，入口保持index.main，保留原运行时和变量。
3. **EdgeOne：部署最新main，包含根目录edge-functions。** 构建设置沿用现有值，不能只上传dist。
4. **环境变量：无需改动。** 两端ECLUB_PROXY_SECRET保持现有相同4位数字；Cookie、Origin、数据库、七牛和上游地址均沿用。
5. **版本核对：** 官网/api/health响应头应同时包含X-EClub-API-Revision: gateway-body-v5、X-EClub-Backend-Revision: gateway-body-v5。再重试登录、刷新及退出。

如果仍有错误，提供新增category为transport的日志行及Response头即可。诊断只含请求ID、格式、大小、标记类型和阶段，不含正文、正文哈希、密码、Cookie或密钥。后端解析错误响应头含X-EClub-Body-Error；旧日志不能证明新代码已运行。没有云控制台和生产访问能力，不宣称已替用户完成生产发布或真实手机验收。

## 完整云函数包

ZIP根目录直接包含index.js、package.json、package-lock.json、全部node_modules运行依赖、原SQL和部署文档（包括DEPLOY-GATEWAY-BODY.md），入口index.main。大小 12,311,836 字节，SHA-256：

```
7f348cbba061386abeed81f9ac1ef1b33bd9055e1b9d3abbf4bcbae1f030c80f
```

## 验证

npm ci和npm run check通过，81项测试通过、0失败、0跳过，含标记的布尔/字符串语义、UTF-8/BOM、Base64、字节视图边界、解析前后大小限制、诊断隐私，以及ArrayBuffer流块和字符串false组合下的登录/会话/RBAC/CSRF/退出与原生PG/HTTPS RPC业务回归。类型、Lint、生产构建和Web API边缘函数编译通过。

从最终ZIP解压后，实际Node18.15.0验证非空JSON正文、字符串false与true网关事件、版本头、4位签名和Cookie头通过。无新增运行依赖，npm audit --omit=dev仍为既有3项moderate、0 high/critical，退出码1。

本次是小修，不刷新稳定Linux/运维归档，已确认其原内容和时间戳保持；不进行生产数据库或服务器迁移。[版本摘要](release-state.json)记录组件来源。4位代理配置的既有IP防伪限制不变，账号密码和会话验证继续独立执行。
