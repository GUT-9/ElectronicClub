import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export const randomToken = () => randomBytes(32).toString('base64url')
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt)
  return `scrypt$${salt}$${key.toString('hex')}`
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  )
}
export async function verifyPassword(password: string, hash: string) {
  const parts = hash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    await derive(password, 'invalid-credential-padding')
    return false
  }
  const key = await derive(password, parts[1]!)
  const expected = Buffer.from(parts[2]!, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}
