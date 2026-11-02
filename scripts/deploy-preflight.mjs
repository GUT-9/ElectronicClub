// Offline plan: never prints values, never initializes, never contacts production.
const http = process.env.DB_DRIVER !== 'postgres-tcp'
const checks = http
  ? {
      environmentPresent: !!process.env.CLOUDBASE_ENV_ID,
      serverIdentityPresent:
        !!process.env.CLOUDBASE_APIKEY ||
        !!(
          process.env.TENCENTCLOUD_SECRETID &&
          process.env.TENCENTCLOUD_SECRETKEY
        ),
      originPresent: !!process.env.ALLOWED_ORIGIN,
      secureCookie: process.env.COOKIE_SECURE !== 'false',
    }
  : {
      databaseUrlPresent: !!process.env.DATABASE_URL,
      caPresent: !!process.env.PG_CA_CERT,
      originPresent: !!process.env.ALLOWED_ORIGIN,
      secureCookie: process.env.COOKIE_SECURE !== 'false',
    }
const concurrency = Number(process.env.FUNCTION_MAX_CONCURRENCY),
  limit = Number(process.env.PG_CONNECTION_LIMIT)
if (!http) {
  checks.connectionBudgetKnown =
    Number.isInteger(concurrency) &&
    concurrency > 0 &&
    Number.isInteger(limit) &&
    limit > 0
  checks.connectionBudgetFits =
    checks.connectionBudgetKnown && concurrency * 4 + 2 <= limit
}
console.log(
  JSON.stringify(
    {
      checks,
      notes: [
        'HTTPS mode uses the environment ID and the SCF execution identity (or optional private API key). SQL RPC role permissions are still required.',
        'In TCP mode, endpoint and port must come from the provider, not the environment ID.',
        'Run diagnose.js with the SAME DB_DRIVER and credentials as the function.',
        'A successful management SQL API call does not prove PostgreSQL TCP access.',
      ],
    },
    null,
    2,
  ),
)
if (!Object.values(checks).every(Boolean)) process.exitCode = 1
