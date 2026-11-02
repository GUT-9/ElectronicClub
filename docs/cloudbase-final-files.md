# PostgreSQL兼容修复文件清单

- `.env.example`
- `.gitignore`
- `README.md`
- `apps/functions/package.json`
- `apps/functions/src/bootstrap.ts`
- `apps/functions/src/diagnose.ts`
- `apps/functions/src/index.ts`
- `apps/functions/src/maintenance.ts`
- `apps/functions/src/members/cloud-store.ts`
- `apps/functions/src/members/pg-store.ts`
- `apps/functions/src/runtime.ts`
- `cloudbase/backend.env.example`
- `cloudbase/runtime-package-lock.json`
- `cloudbase/sql/001-schema.sql`
- `cloudbase/sql/002-indexes.sql`
- `cloudbase/sql/003-permissions.sql`
- `docs/cloudbase-final-deploy.md`
- `docs/cloudbase-final-files.md`
- `package-lock.json`
- `package.json`
- `scripts/build-functions.mjs`
- `scripts/package-functions.mjs`
- `tests/cloud-store.test.ts`
- `tests/postgres.test.ts`

- `.github/workflows/ci.yml`（新增真实PostgreSQL服务，避免CI默默跳过数据库测试）
