<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getMajorExplorationDetail, getProfessionDashboard } from '../api'
import { validateMajorSelection } from '../major-comparison'
import { buildMajorExplorationBrief, buildMajorExplorationBriefText, type MajorExplorationBrief } from '../major-exploration-brief'
import { interactionError } from '../interaction-errors'
import LearningFactList from './LearningFactList.vue'

const props = defineProps<{ profileId: string; majorIds: number[]; studentName: string;
  effectiveMode: 'exploration' | 'application'; refreshContext?: () => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const brief = ref<MajorExplorationBrief | null>(null), loading = ref(false), error = ref(''), copyStatus = ref('')
const manualOpen = ref(false), plainTextField = ref<HTMLTextAreaElement | null>(null)
const plainText = computed(() => brief.value ? buildMajorExplorationBriefText(brief.value) : '')
let request = 0, alive = true
onBeforeUnmount(() => { alive = false; request++ })
watch(() => `${props.profileId}|${props.majorIds.join(',')}`, () => { void load() }, { immediate: true })
async function load() {
  const token = ++request, profileId = props.profileId
  brief.value = null; error.value = ''; copyStatus.value = ''; manualOpen.value = false; loading.value = true
  try {
    const ids = validateMajorSelection(props.majorIds, 'brief')
    let mode: 'exploration' | 'application'
    if (props.refreshContext) {
      await props.refreshContext(); await nextTick()
      if (!alive || token !== request || props.profileId !== profileId) return
      mode = props.effectiveMode
    } else {
      const dashboard = await getProfessionDashboard(profileId)
      if (!alive || token !== request || props.profileId !== profileId) return
      mode = dashboard.mode
    }
    const details = await Promise.all(ids.map(id => getMajorExplorationDetail(profileId, id)))
    if (!alive || token !== request || props.profileId !== profileId) return
    if (details.some((detail, index) => detail.identity.id !== ids[index])) throw new Error('返回的专业与选择不一致，请重新读取')
    brief.value = buildMajorExplorationBrief({ studentName: props.studentName, effectiveMode: mode,
      generatedAt: new Date().toISOString(), details })
  } catch (value) {
    if (alive && token === request && props.profileId === profileId) error.value = interactionError(value, '专业简报生成失败，请检查网络后重试')
  } finally { if (alive && token === request) loading.value = false }
}
async function copy() {
  if (!brief.value || loading.value) return
  const token = request, text = plainText.value
  copyStatus.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    if (alive && token === request) copyStatus.value = '已复制专业简报，可用于家庭讨论'
  } catch {
    if (!alive || token !== request) return
    manualOpen.value = true; copyStatus.value = '复制失败，请手动选择下方纯文本复制'
    await nextTick()
    if (alive && token === request) { plainTextField.value?.focus(); plainTextField.value?.select() }
  }
}
</script>

<template>
  <section class="major-exploration-brief" aria-label="专业探索简报" :aria-busy="loading">
    <header><button type="button" aria-label="返回收藏" @click="emit('close')">← 返回收藏</button><button type="button" :disabled="loading" @click="load">重新生成专业简报</button></header>
    <h3>专业探索简报</h3>
    <p v-if="loading" role="status">正在读取当前模式、材料与家庭备注…</p>
    <div v-else-if="error" class="brief-failure" role="alert"><p>{{ error }}</p><button type="button" @click="load">重试专业简报</button></div>
    <template v-else-if="brief">
      <p class="brief-context">“{{ brief.studentName }}”的公开档案 · 生成于 {{ new Date(brief.generatedAt).toLocaleString('zh-CN') }}</p>
      <p class="brief-mode">{{ brief.modeNote }}</p>
      <article v-for="item in brief.items" :key="item.majorId" :data-major-id="item.majorId" class="brief-major">
        <header><h4>{{ item.name }}</h4><span>{{ item.code }} · 已关注</span></header>
        <section><h5>学习与职业依据</h5><LearningFactList :facts="item.evidence" empty-text="当前材料待补充或已不可用，不补造学习或职业事实。" /></section>
        <section><h5>主要未知</h5><p>{{ item.unknown }}</p></section>
        <section><h5>家庭原始备注</h5><p class="brief-original-note">{{ item.note === null ? '还没有家庭讨论备注' : item.note }}</p></section>
        <section><h5>下一步只做</h5><p>{{ item.nextAction }}</p></section>
      </article>
      <p class="brief-context">培养材料仅适用于所注明的学校与年份，不能据此认定当年可报或位次可达。</p>
      <footer><p role="status" class="brief-copy-status">{{ copyStatus || '用于家庭讨论，不构成录取或就业承诺。' }}</p><button type="button" @click="copy">复制专业简报</button></footer>
      <details :open="manualOpen" class="brief-plain-text" @toggle="manualOpen = ($event.target as HTMLDetailsElement).open"><summary>查看专业简报纯文本</summary><label>可手动复制的内容<textarea ref="plainTextField" :value="plainText" readonly rows="12" aria-label="专业简报纯文本"></textarea></label></details>
    </template>
  </section>
</template>

<style scoped>
.major-exploration-brief{color:#253e2f;line-height:1.7}.major-exploration-brief>header{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:8px 32px 20px 0}.major-exploration-brief button{font:inherit;min-height:36px;padding:6px 11px;border:1px solid #cbd8ce;border-radius:7px;background:#fff;color:#285b40;cursor:pointer}.major-exploration-brief button:disabled{opacity:.55;cursor:default}.major-exploration-brief :focus-visible{outline:2px solid #46785a;outline-offset:3px}.major-exploration-brief>h3{font-size:24px;margin:0}.brief-context{font-size:12px;color:#697b6d;line-height:1.8;margin:8px 0 12px;overflow-wrap:anywhere}.brief-mode{font-size:13px;color:#365d43;margin:0 0 20px}.brief-failure{color:#873c2d;font-size:13px}.brief-major{padding:18px 0;border-top:1px solid #cfddce}.brief-major>header{display:flex;align-items:baseline;flex-wrap:wrap;gap:12px}.brief-major h4{font-size:19px;margin:0}.brief-major header span{font-size:12px;color:#6c7c6e}.brief-major section{margin-top:16px}.brief-major h5{font-size:13px;margin:0 0 7px}.brief-major section>p{font-size:13px;margin:0;color:#536a58;overflow-wrap:anywhere}.brief-original-note{white-space:pre-wrap}.major-exploration-brief>footer{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin:15px 0}.brief-copy-status{font-size:12px;color:#697b6d;margin:0}.brief-plain-text{font-size:12px;margin-top:12px}.brief-plain-text summary{cursor:pointer;color:#315f43;padding:5px 0}.brief-plain-text label{display:block;margin-top:8px;color:#687b6d}.brief-plain-text textarea{box-sizing:border-box;width:100%;padding:10px;margin-top:6px;border:1px solid #c8d5c8;border-radius:7px;background:#fff;color:#2b4934;font:inherit;line-height:1.7;resize:vertical}
@media(max-width:560px){.major-exploration-brief>h3{font-size:21px}.major-exploration-brief>header{margin-right:30px}.major-exploration-brief>footer{display:grid}.major-exploration-brief>footer button{width:100%}}
</style>
