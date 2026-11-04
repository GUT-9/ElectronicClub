# 本次修改文件

以下为权限分组、正文图片与界面优化的源码/迁移/测试清单。完整云函数 ZIP 和 SHA256 在 deployment-packages。

- `README.md`
- `apps/functions/src/forum-maintenance.ts`
- `apps/functions/src/forum/images.ts`
- `apps/functions/src/forum/service.ts`
- `apps/functions/src/forum/storage.ts`
- `apps/functions/src/index.ts`
- `apps/functions/src/media/model.ts`
- `apps/functions/src/media/query.ts`
- `apps/functions/src/media/service.ts`
- `apps/functions/src/media/storage.ts`
- `apps/functions/src/members/http-store.ts`
- `apps/functions/src/members/memory-store.ts`
- `apps/functions/src/members/model.ts`
- `apps/functions/src/members/pg-store.ts`
- `apps/functions/src/members/service.ts`
- `apps/functions/src/stage3/model.ts`
- `apps/functions/src/stage3/service.ts`
- `apps/web/src/components/ContentEditor.vue`
- `apps/web/src/components/PopupNotice.vue`
- `apps/web/src/components/SafeMarkdown.vue`
- `apps/web/src/content.ts`
- `apps/web/src/cover.ts`
- `apps/web/src/layouts/AdminLayout.vue`
- `apps/web/src/media.ts`
- `apps/web/src/member-api.ts`
- `apps/web/src/router.ts`
- `apps/web/src/style.css`
- `apps/web/src/views/AdminView.vue`
- `apps/web/src/views/AuditView.vue`
- `apps/web/src/views/ForumEditorView.vue`
- `apps/web/src/views/MemberEditView.vue`
- `apps/web/src/views/MembersView.vue`
- `apps/web/src/views/PublicationDetailView.vue`
- `apps/web/src/views/PublicationListView.vue`
- `apps/web/src/views/RolesView.vue`
- `apps/web/src/views/Stage3AdminView.vue`
- `cloudbase/sql/011-content-media-verify.sql`
- `cloudbase/sql/011-content-media.sql`
- `docs/content-media-deploy.md`
- `package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/media.ts`
- `scripts/build-functions.mjs`
- `scripts/generate-media-sql.mts`
- `tests/helpers/media-suite.ts`
- `tests/media.test.ts`
- `tests/postgres.test.ts`

配套说明：`docs/content-media-deploy.md`。
