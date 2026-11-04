# 第四阶段电子社区 · 完整CloudBase部署包

源码提交 `8f0a9d9825e3dcc574b54f13d88cf9142851cafd`。论坛版块、帖子/附图、评论回复、点赞收藏、通知举报和动态权限管理已实现，保留原成员、活动、签到、文章及弹窗API。

直接下载 [electronicclub-api.zip](electronicclub-api.zip)（GitHub文件页Download raw file）。ZIP根目录含index.js、package.json、package-lock.json、node_modules完整运行依赖、diagnose/bootstrap及私有forum-maintenance.js、全部SQL和部署文档。入口 **index.main**，已使用实际 **Node18.15** 验证。没有注入真实密码、密钥、生产测试账号或测试帖子。

**部署顺序：**先在已有第三阶段数据库执行 [009-stage4-forum.sql](../cloudbase/sql/009-stage4-forum.sql) 和 [只读核对SQL](../cloudbase/sql/verify-stage4-forum.sql)，再上传本ZIP到现有electronicclub-api，最后更新EdgeOne前端。不要重新初始化数据库、重建管理员或修改密码。完整环境、全部新增API和回滚见 [第四阶段部署文档](../docs/stage4-deploy.md)，[修改文件清单](../docs/stage4-files.md)。

验证：npm ci成功；npm run check包含ESLint、TypeScript、50项全部通过的测试（真实本地PG/RPC，0跳过）及生产构建。真实无CREATEROLE安装、迁移重试和旧数据摘要保持不变。浏览器375/430/1440/1920通过成员/管理流程及原JPG、PNG/WebP上传。最终Node18.15部署入口通过本地身份桥接/真实受限PG的登录、首次改密、论坛写读、图片二进制及私有清理。**不是腾讯云部署成功证明；本交付未执行生产SQL或云函数上传。**

生产依赖仍有10项moderate、0high/critical，未新增运行依赖。Node18生命周期、默认域名生产限制、真实云Cookie/二进制网关及免费配额仍需验收。图片默认32MiB编码文本预算可控，不额外开通付费服务。

大小：12,198,941字节。SHA-256：

```
433b82e15283a90833aca92691e8981e8af364a8d72957ae1040c56137041d08
```
