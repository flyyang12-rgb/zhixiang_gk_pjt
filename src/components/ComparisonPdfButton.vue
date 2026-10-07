<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { downloadComparisonPdf } from '../api'
const props = defineProps<{ profileId: string; kind: 'major' | 'school'; ids: number[]; disabled?: boolean }>()
const busy = ref(false), message = ref(''), failed = ref(false)
let sequence = 0, controller: AbortController | null = null
watch(() => `${props.profileId}|${props.kind}|${props.ids.join(',')}`, reset)
onBeforeUnmount(reset)
function reset() { sequence++; controller?.abort(); controller = null; busy.value = false; message.value = ''; failed.value = false }
async function download() {
  if (busy.value || props.disabled) return
  const token = ++sequence
  controller = new AbortController(); busy.value = true; message.value = ''; failed.value = false
  try {
    await downloadComparisonPdf(props.profileId, props.kind, props.ids, controller.signal)
    if (token === sequence) message.value = 'PDF 已下载，包含当前资料、来源与已保存备注'
  } catch (error) {
    if (token === sequence) { failed.value = true; message.value = error instanceof Error ? error.message : 'PDF 导出失败，请重试' }
  } finally { if (token === sequence) { busy.value = false; controller = null } }
}
</script>
<template>
  <div class="comparison-pdf-action">
    <button type="button" class="comparison-export" :disabled="busy || disabled" :aria-busy="busy" @click="download"><span v-if="busy" class="pdf-progress" aria-hidden="true"></span>{{ busy ? '正在生成 PDF…' : '导出对比 PDF' }}</button>
    <p v-if="message" :role="failed ? 'alert' : 'status'" :class="['pdf-feedback', { 'is-error': failed }]">{{ message }}</p>
  </div>
</template>
