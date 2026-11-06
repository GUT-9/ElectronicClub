# Repository delivery policy

- Maintain one business codebase for CloudBase + EdgeOne and Linux self-hosting. Keep authentication, RBAC and database behavior compatible with both.
- User policy: after a **major change**, refresh the Linux deployment bundle and operations bundle, replacing their stable files in `deployment-packages/`. Do not regenerate these persistent archives for small fixes or cosmetic updates. Do not modify an unchanged component/archive.
- Major changes include new business features, schema changes, authentication/permission architecture and deployment architecture. When completing one, increment `release/major.json` generation with a concrete reason and run `npm run release:refresh`. The CI release job also processes this intent after checks succeed. Small changes must leave this intent and the Linux/operations release artifacts unchanged.
- `release-state.json` records component content digests. Release tooling must preserve byte-identical archives and metadata for unchanged components. CloudBase runtime delivery follows its own content digest; self-host-only changes must not replace the existing CloudBase ZIP.
- Never modify historical deployed migrations to change behavior. Add a new migration and add it to `deploy/linux/migrations.json` when needed.
- Builds and CI only prepare/test packages. Do not migrate the production database, switch domains, initialize production members, reset passwords or deploy to a user's server until the user requests the actual migration/deployment.
- Never include `.env`, backup files, private keys, credentials or `.state` in release archives. Backups and server secrets stay outside immutable code releases.
