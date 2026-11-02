# 第二阶段文件清单

基于 main `6e9b76e` 开发；未重新初始化仓库。完整实现和部署说明见 [member-system.md](member-system.md)。

| 状态 | 文件 |
| --- | --- |
| 修改 | `.env.example` |
| 修改 | `.gitignore` |
| 修改 | `README.md` |
| 修改 | `apps/functions/package.json` |
| 新增 | `apps/functions/src/bootstrap.ts` |
| 修改 | `apps/functions/src/index.ts` |
| 修改 | `apps/functions/src/local.ts` |
| 新增 | `apps/functions/src/maintenance.ts` |
| 新增 | `apps/functions/src/members/cloud-store.ts` |
| 新增 | `apps/functions/src/members/crypto.ts` |
| 新增 | `apps/functions/src/members/memory-store.ts` |
| 新增 | `apps/functions/src/members/model.ts` |
| 新增 | `apps/functions/src/members/service.ts` |
| 新增 | `apps/functions/src/members/store.ts` |
| 新增 | `apps/functions/src/members/xlsx.ts` |
| 新增 | `apps/functions/src/runtime.ts` |
| 修改 | `apps/web/src/components/BrandLogo.vue` |
| 新增 | `apps/web/src/layouts/AdminLayout.vue` |
| 修改 | `apps/web/src/layouts/SiteLayout.vue` |
| 新增 | `apps/web/src/member-api.ts` |
| 修改 | `apps/web/src/router.ts` |
| 新增 | `apps/web/src/stores/auth.ts` |
| 修改 | `apps/web/src/style.css` |
| 新增 | `apps/web/src/views/AccountView.vue` |
| 修改 | `apps/web/src/views/AdminView.vue` |
| 新增 | `apps/web/src/views/AuditView.vue` |
| 新增 | `apps/web/src/views/ImportView.vue` |
| 修改 | `apps/web/src/views/LoginView.vue` |
| 新增 | `apps/web/src/views/MemberEditView.vue` |
| 新增 | `apps/web/src/views/MembersView.vue` |
| 新增 | `apps/web/src/views/PasswordView.vue` |
| 新增 | `apps/web/src/views/RolesView.vue` |
| 新增 | `cloudbase/database.rules.json` |
| 新增 | `cloudbase/indexes.json` |
| 新增 | `cloudbase/runtime-package-lock.json` |
| 新增 | `docs/member-system.md` |
| 新增 | `docs/stage2-files.md` |
| 修改 | `edgeone.json` |
| 修改 | `eslint.config.mjs` |
| 修改 | `package-lock.json` |
| 修改 | `package.json` |
| 修改 | `packages/shared/src/index.ts` |
| 新增 | `packages/shared/src/members.ts` |
| 新增 | `scripts/build-functions.mjs` |
| 新增 | `tests/cloud-store.test.ts` |
| 修改 | `tests/health.test.ts` |
| 新增 | `tests/members.test.ts` |

后端：认证、事务适配、成员与角色权限、XLSX、初始化与隐私工具。前端：登录、用户中心、强制改密、成员/角色/导入/审计页面与动态导航。工程：部署锁文件、配置、文档、19项自动化测试。
