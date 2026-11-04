<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { AuditLog, Page } from '@electronic-club/shared'
import {beijing} from '../stage3'
import { request } from '../member-api'
const page = ref(1),
  data = ref<Page<AuditLog> | null>(null),
  error = ref(''),
  busy = ref(false)
async function load() {
  busy.value = true
  error.value = ''
  try {
    data.value = await request<Page<AuditLog>>(`/audit?page=${page.value}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
onMounted(load)
async function changePage(delta: number) {
  page.value += delta
  await load()
}
</script>
<template>
  <p class="eyebrow">AUDIT TRAIL</p>
  <h1>操作审计</h1>
  <p>记录操作者 UID、操作、目标与字段名称；不记录密码或完整个人资料。</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <div class="table-scroll" v-if="data">
    <table class="data-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>操作者</th>
          <th>操作</th>
          <th>目标</th>
          <th>字段</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in data.items" :key="log.id">
          <td>{{ beijing(log.createdAt) }}</td>
          <td>{{ log.actor }}</td>
          <td>{{ log.action }}</td>
          <td>{{ log.target }}</td>
          <td>{{ log.fields.join(', ') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="pagination" v-if="data">
    <button :disabled="busy || page === 1" @click="changePage(-1)">
      上一页</button
    ><span>第 {{ page }} 页</span
    ><button :disabled="busy || page * 50 >= data.total" @click="changePage(1)">
      下一页
    </button>
  </div>
</template>
