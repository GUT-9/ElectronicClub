// Offline plan: never prints values, never initializes, never contacts production.
const checks = {
  databaseUrlPresent: !!process.env.DATABASE_URL,
  caPresent: !!process.env.PG_CA_CERT,
  originPresent: !!process.env.ALLOWED_ORIGIN,
  secureCookie: process.env.COOKIE_SECURE !== 'false',
}
const concurrency = Number(process.env.FUNCTION_MAX_CONCURRENCY),
  limit = Number(process.env.PG_CONNECTION_LIMIT)
checks.connectionBudgetKnown =
  Number.isInteger(concurrency) &&
  concurrency > 0 &&
  Number.isInteger(limit) &&
  limit > 0
checks.connectionBudgetFits =
  checks.connectionBudgetKnown && concurrency * 4 + 2 <= limit
console.log(
  JSON.stringify(
    {
      checks,
      notes: [
        'Endpoint and port must come from the provider, not the environment ID.',
        'Run diagnose.js FROM THE FUNCTION NETWORK or an officially equivalent authorized network.',
        'A successful management SQL API call does not prove PostgreSQL TCP access.',
      ],
    },
    null,
    2,
  ),
)
if (!Object.values(checks).every(Boolean)) process.exitCode = 1
