<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getMajorExplorationDetail } from '../api'
import { buildMajorComparison, validateMajorSelection, type MajorComparisonItem } from '../major-comparison'
import { interactionError } from '../interaction-errors'
import LearningFactList from './LearningFactList.vue'

const props = defineProps<{ profileId: string; majorIds: number[] }>()
const emit = defineEmits<{ close: [] }>()
const items = ref<MajorComparisonItem[]>([]), loading = ref(false), error = ref(''), refreshedAt = ref('')
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
    <header><button type="button" aria-label="返回收藏" @click="emit('close')">← 返回收藏</button><button type="button" :disabled="loading" @click="load">刷新比较材料</button></header>
    <h3>专业比较</h3><p class="comparison-context">并排看学习与职业证据；顺序按你的选择，不能据此判断个人适合度。</p>
    <p v-if="loading" role="status">正在读取当前专业材料…</p>
    <div v-else-if="error" class="comparison-failure" role="alert"><p>{{ error }}</p><button type="button" @click="load">重试专业比较</button></div>
    <template v-else-if="items.length">
      <p class="comparison-context">本次读取：{{ refreshedAt }}。材料年份逐条标明；重新读取后不沿用已撤回材料。</p>
      <div class="major-comparison-grid" :style="{ '--major-columns': items.length }">
        <article v-for="item in items" :key="item.identity.id" :data-major-id="item.identity.id">
          <header><small>{{ item.identity.category }} · {{ item.identity.code }}</small><h4>{{ item.identity.name }}</h4></header>
          <p v-if="item.status !== 'available'" class="comparison-context">{{ item.status === 'pending' ? '资料待补充' : '当前材料已不可用，需重新核验' }}。仍可比较明确的缺口。</p>
          <section><h5>学什么</h5><LearningFactList :facts="item.curriculum" empty-text="课程材料待补充，不根据专业名称猜课程。" /></section>
          <section><h5>怎么学</h5><LearningFactList :facts="item.activities" empty-text="学习活动材料待补充。" /></section>
          <section v-if="item.learningPrerequisites.length || item.coursePrerequisites.length"><h5>学习准备与课程先修</h5><p class="comparison-context">这是学习或大学课程条件，不是高考选科资格。</p><LearningFactList :facts="[...item.learningPrerequisites, ...item.coursePrerequisites]" /></section>
          <section><h5>职业方向与门槛</h5><p v-if="!item.careers.length" class="comparison-context">职业方向材料待补充，不拼凑毕业去向。</p><div v-for="career in item.careers" :key="career.id" class="comparison-career"><h6>{{ career.name }}</h6><LearningFactList :facts="career.evidence" /><p class="comparison-context">读研、考证或职业准入</p><LearningFactList :facts="career.requirements" empty-text="门槛材料待补充，不能认定本科可直接进入。" /></div></section>
          <section><h5>选科证据</h5><p class="comparison-context">{{ item.admission.reason }}。招生年 {{ item.admission.admissionYear }}，材料年另行标明。</p><LearningFactList :facts="item.admissionFacts" empty-text="当前范围的选科材料待核验，未知不表示不限。" /></section>
          <section v-if="item.otherInstances.length"><h5>另外的学校或年份实例</h5><p class="comparison-context">这些材料不替代指定范围的缺口。</p><LearningFactList :facts="item.otherInstances" /></section>
          <section><h5>资料缺口</h5><ul v-if="item.dataGaps.length"><li v-for="gap in item.dataGaps" :key="gap">{{ gap }}</li></ul><p v-else class="comparison-context">当前字段有材料；仍需核对实际学习意愿与当年招生计划。</p><p class="comparison-next">下一步只做：{{ item.nextAction }}</p></section>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.major-comparison{color:#253e2f;line-height:1.7}.major-comparison>header{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:8px 32px 20px 0}.major-comparison button{font:inherit;min-height:36px;padding:6px 11px;border:1px solid #cbd8ce;border-radius:7px;background:#fff;color:#285b40;cursor:pointer}.major-comparison button:disabled{opacity:.55;cursor:default}.major-comparison :focus-visible{outline:2px solid #46785a;outline-offset:3px}.major-comparison>h3{margin:0;font-size:24px}.comparison-context{font-size:12px;color:#687b6d;line-height:1.8;margin:7px 0 12px;overflow-wrap:anywhere}.comparison-failure{color:#873c2d;font-size:13px}.major-comparison-grid{display:grid;grid-template-columns:repeat(var(--major-columns),minmax(0,1fr));gap:20px;margin-top:20px}.major-comparison-grid>article{min-width:0;overflow-wrap:anywhere}.major-comparison-grid>article>header{border-bottom:1px solid #d3dfd2;padding-bottom:12px}.major-comparison-grid small{font-size:11px;color:#708274}.major-comparison-grid h4{font-size:18px;margin:4px 0}.major-comparison-grid section{padding:17px 0;border-bottom:1px solid #e1e8dc}.major-comparison-grid h5{font-size:14px;margin:0 0 10px}.major-comparison-grid h6{font-size:13px;margin:5px 0 9px}.major-comparison-grid ul{padding-left:18px;font-size:12px;color:#766d52}.comparison-next{font-size:12px;margin:10px 0 0;color:#435f48}.comparison-career+.comparison-career{margin-top:16px}
@media(max-width:700px){.major-comparison-grid{grid-template-columns:1fr;gap:26px}.major-comparison-grid>article>header{border-top:1px solid #cbd9ca;padding-top:14px}.major-comparison>header{margin-right:30px}.major-comparison>h3{font-size:21px}}
</style>
