# CloudBase 控制台部署包：跨站会话开发联调

本ZIP对应源码 `37c668c15af49e7ef4cd681fd01d1ab927f700e6`。GitHub文件页点击electronicclub-api.zip → Download raw file。

本轮修改了函数Cookie逻辑，必须上传新ZIP才支持COOKIE_SAMESITE。入口index.main，兼容Node18.15，完整node_modules已包含。

少量开发联调可显式配置 `COOKIE_SAMESITE=none`，保留COOKIE_SECURE=true和精确HTTPS ALLOWED_ORIGIN。默认仍Lax；非HTTPS或非Secure的None配置会拒绝，CSRF和RBAC保留。浏览器仍可禁止第三方Cookie，这不改变默认API域名开发测试限制，不代表正式生产部署可用。

npm run check通过37项测试（含真实PG），浏览器验证200后401会显示会话未恢复并留在登录页。前端需从最新main构建。SQL仍使用现有service_role安装版本。

ZIP大小12,105,142字节；SHA256 `2e4f19b22046d19f189ec47d7fb504cc48dbe73c4a663a07daf873794d5c265d`。本轮未执行腾讯云函数部署或云端账号操作。详细步骤见[部署文档](../docs/cloudbase-https-runtime.md)。
