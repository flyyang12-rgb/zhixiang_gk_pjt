<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getMajorExplorationDetail } from '../api'
import { buildMajorComparison, validateMajorSelection, type MajorComparisonItem } from '../major-comparison'
import { interactionError } from '../interaction-errors'
import LearningFactList from './LearningFactList.vue'
import ComparisonPdfButton from './ComparisonPdfButton.vue'

const props = defineProps<{ profileId: string; majorIds: number[] }>()
const emit = defineEmits<{ close: [] }>()
const items = ref<MajorComparisonItem[]>([]), loading = ref(false), error = ref(''), refreshedAt = ref('')
const dimensions = ['学什么', '怎么学', '学习准备与课程先修', '职业方向与门槛', '选科证据', '另外的学校或年份实例', '资料缺口', '家庭原始备注']
let request = 0, alive = true
onBeforeUnmount(() => { alive = false; request++ })
watch(() => `${props.profileId}|${props.majorIds.join(',')}`, () => { void load() }, { immediate: true })
async function load() {
  const token = ++request, profileId = props.profileId
  items.value = []; error.value = ''; refreshedAt.value = ''; loading.value = true
  try {
    const ids = validateMajorSelection(props.majorIds, 'comparison')
    const details = await Promise.all(ids.map(id => getMajorExplorationDetail(profileId, id)))
    if (!alive || token !== request || props.profileId !== profileId) return
    if (details.some((detail, index) => detail.identity.id !== ids[index])) throw new Error('返回的专业与选择不一致，请重新读取')
    items.value = buildMajorComparison(details)
    refreshedAt.value = new Date().toLocaleString('zh-CN')
  } catch (value) {
    if (alive && token === request && props.profileId === profileId) error.value = interactionError(value, '专业比较读取失败，请检查网络后重试')
  } finally { if (alive && token === request) loading.value = false }
}
</script>

<template>
  <section class="major-comparison" aria-label="专业比较" :aria-busy="loading">
    <header class="comparison-toolbar"><button type="button" class="comparison-back" aria-label="返回收藏" @click="emit('close')">← 返回收藏</button><div class="comparison-tools"><button type="button" class="comparison-refresh" :disabled="loading" @click="load">刷新比较材料</button><ComparisonPdfButton :profile-id="profileId" kind="major" :ids="majorIds" :disabled="loading || !!error || !items.length" /></div></header>
    <span class="comparison-eyebrow">学习与职业证据</span><h3>专业比较</h3><p class="comparison-context">按维度并排看 {{ majorIds.length }} 个专业。选择顺序不表示个人适合度。</p>
    <p v-if="loading" role="status">正在读取当前专业材料…</p>
    <div v-else-if="error" class="comparison-failure" role="alert"><p>{{ error }}</p><button type="button" @click="load">重试专业比较</button></div>
    <template v-else-if="items.length">
      <details class="comparison-updated"><summary>导出时重新读取当前有效资料与已保存备注</summary><p>当前比较读取于 {{ refreshedAt }}</p></details>
      <p class="comparison-scroll-hint">左右滑动查看全部 {{ items.length }} 个专业；同一行比较同一维度。</p>
      <div class="comparison-table-wrap" tabindex="0" role="region" aria-label="可横向滚动的专业比较表">
        <table class="comparison-table" :style="{ '--comparison-columns': items.length }">
          <thead><tr><th scope="col" class="comparison-dimension">比较维度</th><th v-for="item in items" :key="item.identity.id" scope="col" :data-major-id="item.identity.id"><small>{{ item.identity.category }} · {{ item.identity.code }}</small><h4>{{ item.identity.name }}</h4><span class="comparison-material-status">{{ item.status === 'available' ? '有已核验资料' : item.status === 'pending' ? '资料待补充' : '资料需重新核验' }}</span></th></tr></thead>
          <tbody><tr v-for="(dimension, index) in dimensions" :key="dimension"><th scope="row">{{ dimension }}</th><td v-for="item in items" :key="item.identity.id">
            <LearningFactList v-if="index === 0" :facts="item.curriculum" empty-text="课程材料待补充，不根据专业名称猜课程。" />
            <LearningFactList v-else-if="index === 1" :facts="item.activities" empty-text="学习活动材料待补充。" />
            <template v-else-if="index === 2"><p class="comparison-context">学习或大学课程条件，不是高考选科资格。</p><LearningFactList :facts="[...item.learningPrerequisites, ...item.coursePrerequisites]" empty-text="学习准备材料待补充。" /></template>
            <template v-else-if="index === 3"><p v-if="!item.careers.length" class="comparison-context">职业方向材料待补充。</p><div v-for="career in item.careers" :key="career.id" class="comparison-career"><h5>{{ career.name }}</h5><LearningFactList :facts="career.evidence" /><p class="comparison-context">读研、考证或职业准入</p><LearningFactList :facts="career.requirements" empty-text="门槛材料待补充，不能认定本科可直接进入。" /></div></template>
            <template v-else-if="index === 4"><p>{{ item.admission.reason }}</p><p class="comparison-context">{{ item.admission.admissionYear }} 年招生，材料年另行标明。</p><LearningFactList :facts="item.admissionFacts" empty-text="当前范围选科材料待核验，未知不表示不限。" /></template>
            <template v-else-if="index === 5"><p class="comparison-context">不替代当前指定范围的缺口。</p><LearningFactList :facts="item.otherInstances" empty-text="没有另外的有效实例。" /></template>
            <template v-else-if="index === 6"><ul v-if="item.dataGaps.length" class="comparison-gaps"><li v-for="gap in item.dataGaps" :key="gap">{{ gap }}</li></ul><p v-else>当前字段有材料，仍需核对当年招生计划。</p><p class="comparison-next"><b>下一步只做</b>{{ item.nextAction }}</p></template>
            <p v-else class="comparison-note">{{ item.note ?? '未添加家庭讨论备注' }}</p>
          </td></tr></tbody>
        </table>
      </div>
    </template>
  </section>
</template>
