# 记录ID一致性与封面保存修复部署包

源码提交 `450891e28199b07b5d40840c6182a4b3dcdb2544`。修复旧JSON中的id与数据库主键不一致时，编辑写入另一条记录的问题；统一活动/文章读写主键，并保留报名和签到关联。前端检查编辑响应ID，提交未执行或列表刷新失败不再误报成功。

下载 [electronicclub-api.zip](electronicclub-api.zip)。先上传现有 `electronicclub-api`，入口 `index.main`，再更新 EdgeOne 前端。兼容 Node18.15，无新增环境变量，无DDL迁移，不重新初始化成员或管理员。保留POST编辑兼容入口及PATCH。步骤见 [部署说明](../docs/stage3-deploy.md)。

[只读诊断SQL](../cloudbase/sql/diagnose-content-identity.sql)可检查实际生产数据；仅返回主键/id一致性、封面字符数、更新时间及目录引用。已在真实本地PG验证会检测错配且不修改数据。是否为生产根因仍待真实查询，不能将构造数据复现等同于线上确诊。

`npm run check`：43项全部通过（0跳过），包含真实本地PG/RPC的错配ID、原记录更新、另一记录不被覆盖及报名关联测试。浏览器使用用户原始129,028字节JPEG通过错配记录编辑、公开显示、busy跳过及列表刷新失败提示回归。Node18.15最终打包入口加载、健康200和未登录401通过。生产依赖10项moderate，0high/critical。未执行CloudBase上传或生产数据修改。

ZIP包含完整运行依赖和部署资源，不含实际密码或密钥。大小：12,142,390字节。

SHA-256：

```
73ccd05e996ff0766ea5def39fc58599ffd3e4ef5d4e552c819751fd0c28d642
```
