# CloudBase部署包：8位密码下限

源码提交 `076413a0d68fdbd3b5ba71166a2dcdc94f0fa6a7`。密码规则统一为至少8位且包含字母和数字，包括成员改密和私有bootstrap。初始导入凭据仍强制首次改密。

GitHub文件页electronicclub-api.zip → Download raw file，上传现有electronicclub-api，入口index.main，支持Node18.15。前端需从最新main部署才能更新表单最小长度。

npm run check通过38项测试（含真实本地PG），生产构建及完整ZIP校验通过。尚未由本任务执行腾讯云上传。跨站联调COOKIE_SAMESITE配置及默认域名生产限制仍按部署文档执行。

大小：12,105,142字节；SHA256：`d51b8783a3eb2afcbf6149414df6a71f4ad3616ebd9354f22b272d0810d864bf`。不包含真实密码或密钥。
