import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
const magic = Buffer.from('ECLUBBK1'),
  key = Buffer.from(
    (await readFile('/run/secrets/backup_key', 'utf8')).trim(),
    'hex',
  )
const write = async (data) => {
  if (data.length && !process.stdout.write(data))
    await once(process.stdout, 'drain')
}
try {
  if (key.length !== 32) throw Error('Invalid key')
  if (process.argv[2] === 'encrypt') {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv)
    await write(Buffer.concat([magic, iv]))
    for await (const chunk of process.stdin) await write(cipher.update(chunk))
    await write(cipher.final())
    await write(cipher.getAuthTag())
  } else if (process.argv[2] === 'decrypt') {
    let pending = Buffer.alloc(0),
      cipher
    for await (const chunk of process.stdin) {
      pending = Buffer.concat([pending, chunk])
      if (!cipher && pending.length >= 20) {
        if (!pending.subarray(0, 8).equals(magic)) throw Error('Invalid backup')
        cipher = createDecipheriv('aes-256-gcm', key, pending.subarray(8, 20))
        pending = pending.subarray(20)
      }
      if (cipher && pending.length > 16) {
        await write(cipher.update(pending.subarray(0, -16)))
        pending = pending.subarray(-16)
      }
    }
    if (!cipher || pending.length !== 16) throw Error('Incomplete backup')
    cipher.setAuthTag(pending)
    await write(cipher.final())
  } else throw Error('Unknown command')
} catch {
  console.error('Backup encryption/authentication failed')
  process.exitCode = 1
}
