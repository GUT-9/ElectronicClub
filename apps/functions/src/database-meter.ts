let lastWindow = -1
// Only format metadata. Cold instances may emit duplicates; group by window
// across the environment when counting, never sum the number of log lines.
export function noteDatabaseUse(operation: string, now = Date.now()) {
  const window = Math.floor(now / 300000)
  if (window === lastWindow) return
  lastWindow = window
  console.info(JSON.stringify({ category: 'database_window', window,
    startsAt: new Date(window * 300000).toISOString(), operation }))
}
