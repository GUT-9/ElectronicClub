# 角色与权限管理更新

角色管理与权限查询改为两个视角。角色下可以编辑权限、分页查看成员、按完整学号添加成员、移除角色。权限查询显示拥有该权限的成员及全部授予来源（含超级管理员）。移除一个来源角色可能仍保留其他来源；同时会失去该角色的其他权限。成员至少保留一个角色，唯一角色移除时必须选择替代角色。

## 更新顺序

1. 在现有 CloudBase PostgreSQL SQL 编辑器执行 `cloudbase/sql/010-role-access.sql`。要求之前已执行现有 009 及前置迁移。脚本使用事务、版本记录，可重复执行；仅增加查询函数和两个索引，不修改角色、成员、密码或活动数据。无需新环境变量。
2. 上传本次 `deployment-packages/electronicclub-api.zip` 至原 `electronicclub-api` 函数，替换代码，入口保持 `index.main`、Node 18.15 或兼容运行时；保留现有环境变量和网关。核对配套 SHA256。
3. EdgeOne 更新 main 前端并重新构建，保留原 API 地址和域名配置。

后端更新必须与 SQL 同步；旧 ZIP 不包含成员名单和增量分配接口。浏览器不能直接调用该数据库 RPC。`010-role-access-verify.sql` 为可选只读核对，正常应为 backend_allowed=true，anonymous_allowed=false，browser_allowed=false，inconsistent_assignments=0。

## 权限与 API

- `GET /api/roles/:id/members`：成员分页；roles.read + members.read。
- `GET /api/permissions/:id/members`：有效来源成员分页；roles.read + members.read。
- 分页 query：page（默认1）、pageSize（默认20，最大50）、search（最长80）、status（active/disabled/deleted/all）。角色名单默认全部状态；权限名单默认正常成员，禁用/删除不代表可实际使用权限。
- `GET /api/roles/member-lookup?studentId=完整学号`：精确查找；额外 roles.assign，后端校验可管理范围。
- `POST /api/roles/:roleId/members/:uid`：`{action:"add"|"remove",replacementRoleId?:string}`，roles.read + roles.assign。事务内只改目标角色，保留其他角色；幂等；维护人数、审计及最后超级管理员保护。不能分配超过自身权限的角色。实际变更使目标已有会话失效；修改本人需重新登录。

没有直接的个人权限覆盖，权限来自角色并集。仅有 roles.read 的账号不能读取成员身份资料；名单返回姓名、昵称、学号、状态和角色，不返回电话、邮箱等额外资料。职位名称不参与授权。

## 回滚

先恢复上一个前端版本与云函数 ZIP。新增 RPC 和索引可以保留，不影响旧版本；无需回滚任何用户数据。若必须移除，仅在确认新代码已停止调用后执行：

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.ec_access_members(jsonb,integer,integer);
DROP INDEX IF EXISTS electronicclub.access_members_role_lookup;
DROP INDEX IF EXISTS electronicclub.access_roles_permission_lookup;
DELETE FROM electronicclub.schema_migrations WHERE version='010-role-access';
NOTIFY pgrst,'reload schema';
COMMIT;
```

回滚代码不会撤销管理员已经确认的角色分配，应根据审计记录在界面中调整，不恢复整库备份覆盖现有业务数据。

## 本次交付验证

`npm ci` 成功；`npm run check` 通过（SQL 生成一致性、ESLint、TypeScript、51 项测试全部通过且无跳过、前后端生产构建）。真实本地 PostgreSQL 受限角色/RPC验证迁移重复执行、旧数据保持、浏览器角色无法执行 RPC、HTTP 与原生适配器结果一致，以及成员分配、来源并集、幂等、越权、会话撤销、最后超级管理员和唯一角色替换保护。浏览器检查 375/1440 宽布局、成员名单与精确查找、权限来源及跳转；未操作生产环境。最终部署入口使用 Node18.15 加载成功。`npm audit --omit=dev` 仍为原有 10 moderate，0 high/critical；未增加运行依赖。
