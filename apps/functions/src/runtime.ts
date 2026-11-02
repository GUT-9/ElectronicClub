import { MemberService } from './members/service'
import { PgStore } from './members/pg-store'
import { HttpStore } from './members/http-store'
let service: MemberService | undefined
export function getService() {
  return (service ??= new MemberService(
    process.env.DB_DRIVER === 'postgres-tcp' ? new PgStore() : new HttpStore(),
  ))
}
