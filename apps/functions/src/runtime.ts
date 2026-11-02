import { MemberService } from './members/service'
import { CloudStore } from './members/cloud-store'
let service: MemberService | undefined
export function getService() {
  return (service ??= new MemberService(new CloudStore()))
}
