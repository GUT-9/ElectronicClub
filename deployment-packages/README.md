# 当前云环境：4位数字代理配置

最新修复：[网关正文与边缘流块](../docs/gateway-body-deploy.md)。本次需更新云函数ZIP并重部署EdgeOne，SQL及环境变量均不改，4位数字继续使用。两端版本头均应为gateway-body-v5。

源码提交 `c7cebd83f8f78d1484139b0da6a0f5792d1f5a9d`。按用户要求，ECLUB_PROXY_SECRET现在接受4位数字，前导零保留，旧64位配置仍兼容。只调整代理IP签名配置，不改变成员登录密码、Cookie会话或RBAC规则。

## 本次操作顺序

1. **SQL：无需执行。**
2. **CloudBase：上传[新完整ZIP](electronicclub-api.zip)，核对[SHA256](electronicclub-api.zip.sha256)。** 替换原electronicclub-api函数代码，入口仍为index.main，保留已有环境变量。
3. **EdgeOne：从最新main重新部署，包含根目录edge-functions。** 保留原根工作目录、npm ci、npm run build -w @electronic-club/web、apps/web/dist、Node22；不能只上传dist。
4. **两端代码更新后，将变量ECLUB_PROXY_SECRET改为同一4位数字，例如1234。** 分别在CloudBase原API函数环境变量、EdgeOne函数运行变量填写；变量名和值分开，不加VITE前缀，不需要生成命令或文件。保存配置，EdgeOne按需重新发布使变量生效。
5. **验收：** 官网/api/health响应头X-EClub-API-Revision应为four-digit-v4，再验证登录、刷新及退出。没有生产控制台凭据，不把本地验证当作线上发布完成。

4位值易被猜到，不提供可靠的IP防伪能力；不能用它代替账号密码或权限检查。Cookie、CSRF、JSON UTF-8文本转发与旧功能均保留。无其他必需变量、DNS或套餐变更。

[完整配置说明](../docs/proxy-secret-config-fix.md) · [同源接入说明](../docs/same-origin-api.md)。

## 完整云函数包

ZIP根目录直接包含index.js、package.json、package-lock.json、全部node_modules运行依赖、原SQL及部署说明。入口index.main。大小 12,308,247 字节；SHA-256：

```
e67969a5b054964b3580814940a2a10eb265f016acf71f9fca12133cbb681202
```

## 验证与交付状态

npm ci和npm run check通过，75项测试通过、0失败、0跳过，包含4位互通、前导零、不同值拒绝签名、旧配置兼容、4位配置下的登录/会话/RBAC/退出、原生PG/HTTPS RPC业务回归、类型、Lint、构建及Web API边缘函数编译。最终ZIP在实际Node18.15.0下验证4位服务端配置、复制格式、HMAC/篡改拒绝和Cookie头通过。未在生产或真实手机上验收。

无新增运行依赖；npm audit --omit=dev仍为既有3项moderate、0 high/critical，退出码1。按小修规则保持稳定Linux/运维包的原内容及时间戳，不执行生产迁移。[版本摘要](release-state.json)记录各组件来源。
