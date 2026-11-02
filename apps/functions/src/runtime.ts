import { MemberService } from './members/service'
import { PgStore } from './members/pg-store'
let service: MemberService | undefined
export function getService() {
  return (service ??= new MemberService(new PgStore()))
}
