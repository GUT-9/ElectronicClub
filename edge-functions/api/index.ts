import { proxyApi, type ProxyContext } from '../../deploy/edgeone/proxy'
export async function onRequest(context: ProxyContext) {
  return proxyApi(context)
}
