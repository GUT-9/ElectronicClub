# 当前云环境：公开读取不触库与1500点预算目标

公开活动、新闻、论坛、资料和图片改为现有七牛空间提供副本，保留数据库登录、RBAC、成员互动、报名签到。完整顺序、回滚和预算条件见 [部署说明](../docs/public-site-budget-deploy.md)。**1500点不是已实测账单或自动停机上限；缺少共享实例单价时不能宣称达标。**

## 你需要执行的顺序

1. **SQL：** 在CloudBase PostgreSQL执行 [016-public-site-export.sql](../cloudbase/sql/016-public-site-export.sql)，再运行只读 [核对SQL](../cloudbase/sql/016-public-site-export-verify.sql)。只增加受限导出函数和版本，不清数据、不改密码、不创建角色。需已完成015及之前迁移，不重新初始化。
2. **CloudBase：** 下载核对 [完整函数ZIP](electronicclub-api.zip) 与 [SHA256](electronicclub-api.zip.sha256)，替换现有electronicclub-api，入口index.main。运行依赖已打入ZIP根目录；超时设置60秒，内存可保持256MB，保留原网关/数据库/Cookie/Origin/代理配置。
3. **CloudBase环境变量：** 保留原七牛四项配置（QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET、QINIU_DOWNLOAD_DOMAIN），新增 `PUBLIC_SITE_ORIGIN`，填实际桶HTTPS S3源地址。此前截图为 `https://edwell-k12.s3.cn-east-1.qiniucs.com`，实际桶/区域以控制台为准，不加末尾斜杠。先不启用qiniu模式。
4. **EdgeOne：** 部署最新main，包含根目录edge-functions；原构建设置不变，首次先不填EdgeOne的PUBLIC_SITE_ORIGIN。超级管理员打开 `/admin/public-site`，点击“同步公开内容”，确认已同步、待同步图片为0。
5. **CloudBase环境变量：** 设置 `PUBLIC_SITE_MODE=qiniu` 生效，公开读取不再查库。首次同步必须在数据库可用时完成，优化不会恢复已耗尽的额度。
6. **可选且建议的EdgeOne服务端变量：** 填相同的 `PUBLIC_SITE_ORIGIN` 并再次部署，普通公开请求进一步绕过CloudBase函数。七牛Key不填EdgeOne，不放VITE变量。
7. **可选预算预填：** 仅在核实共享实例单价后，在CloudBase填 `PG_POINTS_PER_CORE_SECOND`。未知就留空，后台显示无法判断预算；没有新增需要生成的密钥。

代码推送不等于已上传CloudBase、执行生产SQL或完成真实七牛验收。首次同步未就绪时先保持database模式；不要提前把公开读取切到不存在的副本。

## 验证与效果边界

- npm ci成功。带隔离本地PostgreSQL的npm run check通过：**92项通过、0失败、0跳过**，含原生PG、HTTPS RPC、016幂等与数据保留、受限角色、登录/RBAC、活动报名审核签到、公告、论坛、导入、原JSON/编码/同源回归。
- 公开内容测试连续500次读取，覆盖列表/详情/搜索/分页/下载/图片，数据库调用0；存储故障、私有内容、非法公开查询不SQL回源。并发发布、租约恢复、图片进度恢复和64KiB网关预算通过。
- 实际Chromium验证：保留有效会话刷新8类公开页仍0SQL；发布图片可见；主动报名入口才访问数据库；后台预算未知时不显示达标，明确示例输入下显示1440点；桌面与390px手机布局通过。不是生产站或真实iOS/QQ验收。
- 定时公告和独立公告图片AES-256-GCM加密；未来内容不出现在公开JSON，未到时间图片404，到时读取无SQL，替换公告到期不复现旧公告，密文篡改拒绝。复用已有七牛服务端SecretKey，EdgeOne没有密钥；这部分经函数时间校验而不查库。
- npm audit --omit=dev仍为既有 **3项moderate，0 high/critical**，退出码1，不记为通过；无新增运行依赖。

普通公开浏览的PostgreSQL计算预期为0，动态使用仍有成本。预算预留300点，只有每个活跃段不超过15点、每月不超过80段时，合计预计才不超过1500点；这不是已核实的实际共享单价。300点预留也需结合真实账单核对。后台可填实际价格和活跃覆盖时间计算，外部任务、SQL编辑器和异常请求亦可能消耗资源。

公开页个人状态改为主动加载；静态浏览不再逐次写入成员浏览数。本人待审核内容走鉴权预览。业务保存后同步失败明确提示，管理员可重试；不丢失数据库保存结果。使用S3源避免CDN旧清单，故障不自动SQL回源。公开副本有8MiB清单、4MiB SQL导出及640个引用/32MiB图片预算，超限不静默截断数据。

## 交付与回滚

[版本摘要](release-state.json)记录包对应源码与校验。本次为部署架构大改，generation=4，按约定刷新发生变化的Linux/运维归档；正式服务器迁移仍未执行。

回滚先删EdgeOne公开源变量并部署，再将CloudBase PUBLIC_SITE_MODE改为database；删除CloudBase公开源变量可停止自动同步，恢复旧函数和前端即可。016是增量函数，不删表、不恢复或重置成员密码。七牛副本不代替数据库备份，恢复数据库后应重新同步。
