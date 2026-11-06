import type {
  EventManagerOption,
  Identity,
  Member,
  Role,
} from '@electronic-club/shared'
import { MAX_EVENT_MANAGERS } from '@electronic-club/shared'
import { z } from 'zod'
import { ensure } from '../members/model'
import type { Store, Transaction } from '../members/store'
export async function managerSummaries(
  tx: Transaction,
  uids: string[],
): Promise<EventManagerOption[]> {
  const members = await Promise.all(
    uids.map((id) => tx.get<Member>('users', id)),
  )
  const roleCache = new Map<string, Promise<Role | null>>()
  return Promise.all(
    members
      .filter((m): m is Member => !!m)
      .map(async (member) => ({
        uid: member.uid,
        name: member.name,
        nickname: member.nickname,
        status: member.status,
        roles: (
          await Promise.all(
            member.roleIds.map((id) => {
              if (!roleCache.has(id))
                roleCache.set(id, tx.get<Role>('roles', id))
              return roleCache.get(id)!
            }),
          )
        ).flatMap((r) => (r ? [{ id: r.id, name: r.name }] : [])),
      })),
  )
}

export async function managerOptions(
  tx: Transaction,
  store: Store,
  ctx: Identity,
  method: string,
  resource: string,
  action: string | undefined,
  input: unknown,
  query: Record<string, string>,
) {
  ensure(
    ctx.super || ctx.permissions.includes('events.edit'),
    403,
    'FORBIDDEN',
    '需要活动负责人分配权限',
  )
  const roleCache = new Map<string, Promise<Role | null>>()
  const role = (id: string) => {
    if (!roleCache.has(id)) roleCache.set(id, tx.get<Role>('roles', id))
    return roleCache.get(id)!
  }
  const option = async (member: Member): Promise<EventManagerOption> => ({
    uid: member.uid,
    name: member.name,
    nickname: member.nickname,
    status: member.status,
    roles: (await Promise.all(member.roleIds.map(role))).flatMap((r) =>
      r ? [{ id: r.id, name: r.name }] : [],
    ),
  })
  if (resource === 'manager-roles' && method === 'GET' && !action) {
    const q = z
      .object({ page: z.coerce.number().int().min(1).max(100).default(1) })
      .strict()
      .parse(query)
    const result = await store.list<Role>(
      'roles',
      {},
      { offset: (q.page - 1) * 100, limit: 100 },
    )
    return {
      data: {
        items: result.items.map((r) => ({ id: r.id, name: r.name })),
        total: result.total,
        page: q.page,
        pageSize: 100,
      },
    }
  }
  if (resource === 'manager-options' && method === 'GET' && !action) {
    const q = z
      .object({
        search: z.string().trim().max(100).default(''),
        roleId: z.string().max(64).default(''),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict()
      .parse(query)
    if (q.roleId)
      ensure(await role(q.roleId), 404, 'ROLE_NOT_FOUND', '所选角色不存在')
    const result = await store.list<Member>(
      'users',
      {
        status: 'active',
        _search: q.search,
        ...(q.roleId ? { roleIds: q.roleId } : {}),
      },
      { offset: (q.page - 1) * q.pageSize, limit: q.pageSize },
    )
    return {
      data: {
        items: await Promise.all(result.items.map(option)),
        total: result.total,
        page: q.page,
        pageSize: q.pageSize,
      },
    }
  }
  if (
    resource === 'manager-options' &&
    action === 'resolve' &&
    method === 'POST'
  ) {
    const body = z
      .object({ uids: z.array(z.string().uuid()).max(MAX_EVENT_MANAGERS) })
      .strict()
      .parse(input)
    const members = await Promise.all(
      [...new Set(body.uids)].map((id) => tx.get<Member>('users', id)),
    )
    return {
      data: {
        items: await Promise.all(
          members.filter((m): m is Member => !!m).map(option),
        ),
      },
    }
  }
  if (
    resource === 'manager-options' &&
    action === 'by-role' &&
    method === 'POST'
  ) {
    const body = z
      .object({ roleIds: z.array(z.string().min(1).max(64)).min(1).max(20) })
      .strict()
      .parse(input)
    const members = new Map<string, Member>()
    for (const id of new Set(body.roleIds)) {
      ensure(await role(id), 404, 'ROLE_NOT_FOUND', '所选角色不存在')
      const page = await store.list<Member>(
        'users',
        { status: 'active', roleIds: id },
        { offset: 0, limit: MAX_EVENT_MANAGERS },
      )
      ensure(
        page.total <= MAX_EVENT_MANAGERS,
        409,
        'MANAGER_LIMIT',
        `该角色有效成员超过${MAX_EVENT_MANAGERS}人，请按姓名搜索或分页勾选`,
      )
      for (const member of page.items) members.set(member.uid, member)
      ensure(
        members.size <= MAX_EVENT_MANAGERS,
        409,
        'MANAGER_LIMIT',
        `负责人最多${MAX_EVENT_MANAGERS}人，请减少选择的角色`,
      )
    }
    return {
      data: { items: await Promise.all([...members.values()].map(option)) },
    }
  }
  ensure(false, 405, 'METHOD_NOT_ALLOWED', '方法不支持')
}
