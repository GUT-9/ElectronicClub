# 封面编辑兼容修复部署包

源码提交 `f3bedcf56731a1d3e3ce9abc424376b911deb895`。支持 `POST /api/events/:id/update` 与 `POST /api/articles/:id/update`，保留 PATCH、原活动ID、报名和签到关系。前端保存后重新读取封面确认。

下载 [electronicclub-api.zip](electronicclub-api.zip)（GitHub 文件页 Download raw file）。**先上传现有 electronicclub-api 云函数，再更新 EdgeOne 前端**。入口 `index.main`，兼容 Node.js18.15，不增加环境变量。已有第三阶段数据库无需执行新SQL、重新初始化或重建管理员。完整步骤见 [部署文档](../docs/stage3-deploy.md)。

`npm run check`：42项全部通过，含真实本地PostgreSQL/RPC、约126KB封面编辑、权限及CSRF。实际Node18.15最终部署入口配合本地受限PG账户通过登录、POST编辑、封面持久化和公开读取；浏览器以125,336字节真实JPEG验证编辑、详情及列表显示和错误提示。以上均为本地验证，不代表腾讯云已部署。未执行CloudBase上传或生产数据库操作。

ZIP根目录含index.js、package.json、node_modules、diagnose.js、bootstrap.js及SQL/部署文档。未注入真实密码或密钥。

大小：12,140,669字节。SHA-256：

```
d77a26cc8d3b84b33315d43c5be3c59a15b7c5017b6d7cd0b3dca4e6dd601ecd
```
