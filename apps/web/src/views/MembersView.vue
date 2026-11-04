<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { Member, Page, Role } from '@electronic-club/shared'
import { request, allRoles, download } from '../member-api'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore(),
  data = ref<Page<Member> | null>(null),
  roles = ref<Role[]>([]),
  error = ref(''),
  busy = ref(false),
  exportPage = ref(1)
const filters = reactive({
  search: '',
  college: '',
  className: '',
  roleId: '',
  status: 'all',
  page: 1,
  pageSize: 20,
})
let generation = 0
async function load() {
  const seq = ++generation
  busy.value = true
  error.value = ''
  try {
    const result = await request<Page<Member>>(
      '/members?' +
        new URLSearchParams(
          Object.entries(filters).map(([k, v]) => [k, String(v)]),
        ),
    )
    if (seq === generation) data.value = result
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) busy.value = false
  }
}
async function search() {
  filters.page = 1
  await load()
}
async function exportMembers() {
  try {
    await download(
      `/members/export.xlsx?page=${exportPage.value}`,
      `members-${exportPage.value}.xlsx`,
    )
  } catch (e) {
    error.value = (e as Error).message
  }
}
onMounted(async () => {
  await load()
  if (auth.can('roles.read'))
    try {
      roles.value = await allRoles()
    } catch (e) {
      error.value = (e as Error).message
    }
})
async function changePage(delta: number) {
  filters.page += delta
  await load()
}
</script>
<template>
  <p class="eyebrow">MEMBERS</p>
  <h1>成员列表</h1>
  <div class="action-row">
    <RouterLink
      v-if="auth.can('members.create')"
      class="button button-primary"
      to="/admin/members/new"
      >创建成员</RouterLink
    ><RouterLink
      v-if="auth.can('members.import')"
      class="text-link"
      to="/admin/imports"
      >Excel 批量导入 →</RouterLink
    >
  </div>
  <form class="filter-form" @submit.prevent="search">
    <label
      >学号 / 姓名 / 昵称<input
        v-model="filters.search"
        maxlength="100" /></label
    ><label>学院<input v-model="filters.college" maxlength="100" /></label
    ><label>班级<input v-model="filters.className" maxlength="100" /></label
    ><label
      >角色<select v-model="filters.roleId">
        <option value="">所有角色</option>
        <option v-for="role in roles" :key="role.id" :value="role.id">
          {{ role.name }}
        </option>
      </select></label
    ><label
      >状态<select v-model="filters.status">
        <option value="all">正常及禁用</option>
        <option value="active">正常</option>
        <option value="disabled">禁用</option>
        <option value="deleted">已软删除</option>
      </select></label
    ><button class="button button-primary" :disabled="busy">查询</button>
  </form>
  <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  <p v-if="busy" role="status">正在加载…</p>
  <div class="table-scroll" v-if="data">
    <table class="data-table">
      <thead>
        <tr>
          <th>学号</th>
          <th>姓名</th>
          <th>学院 / 班级</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in data.items" :key="member.uid">
          <td>{{ member.studentId || '已匿名化' }}</td>
          <td>{{ member.name }}</td>
          <td>{{ member.college }} / {{ member.className }}</td>
          <td>{{ member.status }}</td>
          <td>
            <RouterLink class="text-link" :to="`/admin/members/${member.uid}`"
              >查看 / 管理 →</RouterLink
            >
          </td>
        </tr>
        <tr v-if="!data.items.length">
          <td colspan="5">没有符合条件的成员</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="pagination" v-if="data">
    <button :disabled="busy || filters.page === 1" @click="changePage(-1)">
      上一页</button
    ><span>第 {{ filters.page }} 页，共 {{ data.total }} 人</span
    ><button
      :disabled="busy || filters.page * filters.pageSize >= data.total"
      @click="changePage(1)"
    >
      下一页
    </button>
  </div>
  <div class="action-row" v-if="auth.can('members.export')">
    <label
      >导出批次（100条/批）<input
        type="number"
        v-model="exportPage"
        min="1"
        max="10000" /></label
    ><button class="plain-button" @click="exportMembers">
      导出 XLSX（全部有效账号分批）
    </button>
  </div>
</template>
