import { selfHostService } from './server'
async function main() {
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
    if (text.length > 4096) throw Error('Input too large')
  }
  const input = JSON.parse(text)
  await selfHostService().bootstrap(
    { studentId: input.studentId, name: input.name },
    input.password,
  )
  console.log(
    'Initial administrator created; password was not saved to configuration',
  )
  process.exit(0)
}
main().catch(() => {
  console.error(
    'Bootstrap refused or invalid input; existing accounts were not reset',
  )
  process.exit(1)
})
