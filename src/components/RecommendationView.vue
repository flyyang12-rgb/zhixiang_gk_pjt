<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { generateRecommendations, getRecommendations, updateProvinceRank, type RecommendationResult } from '../api'

const props = defineProps<{ profileId: string; studentName: string }>()
const emit = defineEmits<{ advisor: []; school:[number]; rankUpdated: [number] }>()
const result = ref<RecommendationResult | null>(null)
const loading = ref(false)
const activeRisk = ref<'全部' | '冲' | '稳' | '保'>('全部')
const error = ref('')
const provinceRank = ref<number | null>(null)
const candidates = computed(() => result.value?.candidates.filter(item => activeRisk.value === '全部' || item.risk === activeRisk.value) ?? [])

onMounted(async () => {
  try {
    result.value = await getRecommendations(props.profileId)
    if (!result.value || (!result.value.sourceYear && !result.value.candidates.length)) await generate()
  } catch (value) {
    error.value = value instanceof Error ? value.message : '候选清单加载失败'
  }
})

async function generate() {
  loading.value = true
  error.value = ''
  try {
    result.value = await generateRecommendations(props.profileId)
  } catch (value) {
    error.value = value instanceof Error ? value.message : '生成失败'
  } finally {
    loading.value = false
  }
}

async function saveRankAndGenerate() {
  if (!provinceRank.value || provinceRank.value < 1) {
    error.value = '生成冲稳保清单需要填写全省位次'
    return
  }
  loading.value = true
  try {
    await updateProvinceRank(props.profileId, provinceRank.value)
    emit('rankUpdated', provinceRank.value)
    await generate()
  } catch (value) {
    error.value = value instanceof Error ? value.message : '位次保存失败'
    loading.value = false
  }
}
</script>

<template>
  <div class="recommend-page">
    <header class="recommend-head">
      <div><span class="kicker">STEP 02 · 地区 / 学校 / 专业</span><h2>{{ studentName }} 的候选方案</h2><p>先看哪些地方和学校值得选，再比较校内专业。</p></div>
      <div class="recommend-tools"><button class="secondary-action" :disabled="loading" @click="generate">{{ loading ? '计算中…' : '重新计算' }}</button></div>
    </header>

    <div v-if="loading" class="loading-panel"><span class="spinner"></span><p>正在对照位次与专业倾向…</p></div>
    <div v-else-if="error && error.includes('全省位次')" class="rank-required">
      <span>还差一项关键信息</span><h3>补填全省位次后即可生成</h3>
      <p>不同年份试卷难度不同，冲稳保必须用成绩单上的全省位次计算，不能只看当前分数。</p>
      <form @submit.prevent="saveRankAndGenerate"><input v-model.number="provinceRank" type="number" min="1" placeholder="例如：全省第 8,500 名" autofocus><button class="primary-action">保存位次并生成 →</button></form>
      <small>位次会保存到公开档案，所有访客都能查看和修改；如果暂时不知道，可以在高考成绩单或本省一分一段表中查询。</small>
    </div>
    <div v-else-if="error" class="error-notice">{{ error }}</div>
    <template v-else-if="result">
      <div class="recommend-warning">{{ result.warning }}</div>
      <div v-if="!result.candidates.length" class="empty-state"><strong>暂时不能生成冲稳保</strong><p>全国院校地图仍可正常浏览；待导入本省官方投档表后再计算。</p></div>
      <template v-else>
        <div class="risk-tabs"><button v-for="risk in ['全部', '冲', '稳', '保']" :key="risk" :class="{ active: activeRisk === risk }" @click="activeRisk = risk as typeof activeRisk">{{ risk }}</button><span>基于 {{ result.sourceYear }} 投档数据 · 规划位次 {{result.planningCoordinate?.rank?.toLocaleString()||'—'}}（{{result.planningCoordinate?.sampleCount||0}}次） · {{ result.candidates.length }} 所</span></div>
        <div class="candidate-list"><article v-for="item in candidates" :key="item.schoolId"><div class="candidate-school"><span :class="['risk', item.risk]">{{ item.risk }}</span><div><small>{{ item.province }} · {{ item.city }} · {{ item.level }} · {{ item.confidence }}置信度</small><button class="candidate-school-detail" @click="emit('school',item.schoolId)">{{ item.schoolName }} <span>查看详情 →</span></button><p>{{item.unitName}} · 参考最低位次 {{ item.referenceRank.toLocaleString() }} · 规则评分 {{ item.ruleScore }} · {{ item.dataYears.join(' / ') }}</p><p class="school-links"><a :href="item.officialUrl" target="_blank" rel="noopener noreferrer">学校官网 ↗</a><a :href="item.admissionsUrl" target="_blank" rel="noopener noreferrer">本科招生网 ↗</a></p></div></div><div v-if="item.majors.length" class="major-options"><span v-for="major in item.majors.slice(0, 3)" :key="major.name"><b>{{ major.name }}</b><small>{{ major.fit }} · 位次 {{ major.minRank.toLocaleString() }}</small></span></div><p v-else class="unit-evidence-gap">当前只有专业组线，尚不能证明该组包含具体专业。</p></article></div>
        <footer class="recommend-footer"><p>候选已保存到本地，可继续与规划顾问讨论取舍。</p><button class="primary-action" @click="emit('advisor')">和 AI 规划顾问讨论 →</button></footer>
      </template>
    </template>
  </div>
</template>
