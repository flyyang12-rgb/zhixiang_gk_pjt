<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getSchoolDataQuality, type SchoolDataQuality } from '../api'

const data = ref<SchoolDataQuality | null>(null)
const loading = ref(true)
const error = ref('')
const query = ref('')
const page = ref(1)
const province = ref('')
const level = ref('')
const year = ref('')
const factType = ref('')
const status = ref('pending')

const cards = computed(() => data.value
  ? [
      ['学校官网', data.value.summary.officialWebsite],
      ['招生官网', data.value.summary.admissionsWebsite],
      ['优势专业', data.value.summary.featuredMajors],
      ['招生年份', data.value.summary.admissionYears],
    ]
  : [])

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSchoolDataQuality({
      page: page.value,
      pageSize: 24,
      q: query.value.trim() || undefined,
      province: province.value || undefined,
      level: level.value || undefined,
      year: year.value ? Number(year.value) : undefined,
      factType: factType.value || undefined,
      status: status.value,
    })
  } catch (value) {
    error.value = value instanceof Error ? value.message : '数据核验状态加载失败'
  } finally {
    loading.value = false
  }
}

async function search() {
  page.value = 1
  await load()
}

async function changePage(offset: number) {
  if (!data.value) return
  page.value = Math.max(1, page.value + offset)
  await load()
}
</script>

<template>
  <main class="data-quality-admin">
    <header>
      <div>
        <span>SHARED DATA MAINTENANCE</span>
        <h1>院校数据核验</h1>
        <p>覆盖率来自 Supabase。当前入口不设账号权限，未核验事实不会进入普通用户详情。</p>
      </div>
      <a href="/">返回知向工作台 →</a>
    </header>

    <section v-if="data" class="quality-summary">
      <article v-for="card in cards" :key="card[0] as string">
        <span>{{ card[0] }}</span>
        <b>{{ (card[1] as { verified: number }).verified.toLocaleString() }}</b>
        <small>
          已核验 · 待核验 {{ (card[1] as { pending: number }).pending.toLocaleString() }}
          · 不适用 {{ (card[1] as { notApplicable: number }).notApplicable.toLocaleString() }}
          · 官方未发布 {{ (card[1] as { unavailable: number }).unavailable.toLocaleString() }}
        </small>
      </article>
    </section>

    <form class="quality-search" @submit.prevent="search">
      <input v-model="query" placeholder="按院校或城市筛选">
      <input v-model="province" placeholder="省份">
      <select v-model="level"><option value="">全部层次</option><option>本科</option><option>专科</option><option>985</option><option>211</option></select>
      <select v-model="year"><option value="">全部年份</option><option>2023</option><option>2024</option><option>2025</option></select>
      <select v-model="factType"><option value="">全部事实</option><option value="official_website">学校官网</option><option value="admissions_website">招生官网</option><option value="featured_major">优势专业</option><option value="admission_coverage">招生覆盖</option></select>
      <select v-model="status"><option value="pending">待核验</option><option value="verified">已核验</option><option value="unavailable">官方未发布</option><option value="not_applicable">不适用</option></select>
      <button>查询</button>
    </form>

    <div v-if="loading" class="quality-state">正在读取数据库覆盖率…</div>
    <div v-else-if="error" class="quality-state error"><p>{{ error }}</p><button @click="load">重试</button></div>

    <section v-else-if="data" class="quality-list">
      <header><strong>事实审计院校</strong><span>{{ data.totalPending.toLocaleString() }} 所</span></header>
      <article v-for="item in data.items" :key="item.id">
        <div><b>{{ item.name }}</b><span>{{ item.province }} · {{ item.city }} · {{ item.level }}</span></div>
        <ul>
          <li v-for="fact in item.facts" :key="fact.factType">
            <b>{{ fact.factType }}</b> · {{ fact.status }}<template v-if="fact.reason"> · {{ fact.reason }}</template>
          </li>
        </ul>
        <small>{{ item.linksVerifiedAt ? `链接最近核验 ${new Date(item.linksVerifiedAt).toLocaleDateString('zh-CN')}` : '尚无链接核验时间' }}</small>
      </article>
      <footer>
        <button :disabled="page === 1" @click="changePage(-1)">上一页</button>
        <span>第 {{ page }} 页</span>
        <button :disabled="page * data.pageSize >= data.totalPending" @click="changePage(1)">下一页</button>
      </footer>
    </section>

    <aside>
      <b>安全导入边界</b>
      <p>自动发现只生成候选和报告。只有学校身份、官方来源与页面内容核验通过后，才可导入用户可见数据库；失败不得覆盖已有有效事实。</p>
      <code>npm run data:school-links:auto</code>
    </aside>
  </main>
</template>
