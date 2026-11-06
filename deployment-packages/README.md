# 完整 CloudBase 部署包 · 成员登录记录

源码提交 `6cbde26b7d0893f02072c93c4d5a1912d8370fee`。保留之前所有成员、角色授权、活动/签到、文章、弹窗、社区和正文图片 API，新增姓名/学号/IP/设备登录记录与独立权限 `security.logins.read`。

下载 [electronicclub-api.zip](electronicclub-api.zip) 并核对 [SHA256](electronicclub-api.zip.sha256)。ZIP 根目录包含 index.js、package.json、package-lock.json、全部 node_modules 运行依赖、SQL、私有维护和部署说明，入口 **index.main**。不包含真实凭据或生产测试数据。

**升级顺序：**已有011的数据库执行 [012-login-history.sql](../cloudbase/sql/012-login-history.sql) → 替换原electronicclub-api云函数ZIP → EdgeOne更新main。保留原环境变量，不重置成员、密码或角色。默认无需额外IP环境变量，优先平台requestContext；若网关未提供会明确标注，可信转发头的可选配置见文档，不默认信任客户端X-Forwarded-For。

- [登录记录部署、权限、IP来源及回滚](../docs/login-history-deploy.md)
- [可选只读核对SQL](../cloudbase/sql/012-login-history-verify.sql)
- 前置：[正文图片](../docs/content-media-deploy.md) · [角色成员管理](../docs/access-workspace-deploy.md) · [论坛](../docs/stage4-deploy.md)

超级管理员默认可以查看；普通管理员需明确授予新权限，原audit.read不会获得IP/设备字段。旧记录不会伪造补出未采集信息。姓名学号关联当前档案，失败记录注明账号身份未验证；匿名化会原子清除关联IP/UA，原始操作审计响应隐藏这些字段。

`npm ci`与`npm run check`通过，56项测试全部通过且0跳过；实际本地PG/RPC验证迁移可重试、旧数据保持、授权隔离、筛选分页、IPv4/IPv6可信来源、限流去重与匿名化物理清理。浏览器通过新登录/失败尝试采集、查询和成员拒绝、UA安全显示与375/1440布局。最终ZIP的实际Node18.15入口通过采集、查询和旧审计脱敏。没有执行生产SQL或上传CloudBase函数。

未新增运行依赖，当前audit报告3 moderate，0 high/critical。浏览器标识只能推断设备/系统，不能作为已验证硬件或人员身份。

大小：12,242,171 字节。SHA-256：

```
a71172eb87de5999439b3913992175c52552c64affd89f4d427bb1135107515c
```
