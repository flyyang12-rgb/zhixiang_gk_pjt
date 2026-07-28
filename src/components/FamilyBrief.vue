<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildFamilyBrief, buildFamilyBriefText } from '../family-brief'
import type { ProfileSummary, SavedItem, SchoolDetail } from '../api'

const props=defineProps<{profileSummary:ProfileSummary;details:SchoolDetail[];savedItems:SavedItem[]}>()
const emit=defineEmits<{close:[]}>()
const copyStatus=ref('')
const brief=computed(()=>buildFamilyBrief({profileSummary:props.profileSummary,schools:props.details.map(detail=>({
  name:detail.school.name,city:detail.school.city,level:detail.school.level,
  featuredMajors:detail.featuredMajors.map(item=>item.name),admission:detail.admissionContext?.records[0]??null,
  officialUrl:Boolean(detail.school.officialUrl),admissionsUrl:Boolean(detail.school.admissionsUrl),
  note:props.savedItems.find(item=>item.itemType==='school'&&item.itemId===detail.school.id)?.note??null,
}))}))
function onKey(event:KeyboardEvent){if(event.key==='Escape')emit('close')}
async function copy(){try{await navigator.clipboard.writeText(buildFamilyBriefText(brief.value));copyStatus.value='已复制，可以发到家庭群'}catch{copyStatus.value='复制失败，请手动选择文字'}await nextTick()}
onMounted(()=>window.addEventListener('keydown',onKey))
onBeforeUnmount(()=>window.removeEventListener('keydown',onKey))
</script>

<template>
  <div class="family-brief-backdrop" @click.self="emit('close')">
    <section class="family-brief" role="dialog" aria-modal="true" aria-label="给爸妈看的学校简报">
      <header><div><small>仅保存在本机</small><h2>给爸妈看</h2><p>{{profileSummary.province}} · {{profileSummary.subjectGroup}} · {{profileSummary.provinceRank?`当前位次 ${profileSummary.provinceRank.toLocaleString()}`:'暂无可靠位次'}}</p></div><button aria-label="关闭家庭简报" @click="emit('close')">×</button></header>
      <div class="family-brief-schools">
        <article v-for="item in brief" :key="item.name">
          <h3>{{item.name}}</h3><strong>{{item.stance}}</strong>
          <dl><div><dt>两个硬依据</dt><dd><span v-for="evidence in item.evidence" :key="evidence">{{evidence}}</span></dd></div><div><dt>最大风险</dt><dd>{{item.risk}}</dd></div><div><dt>家庭讨论备注</dt><dd>{{item.note}}</dd></div><div><dt>下一步只做</dt><dd>{{item.nextAction}}</dd></div></dl>
        </article>
      </div>
      <aside><b>今晚只讨论三个问题</b><ol><li>弟弟愿不愿学四年？</li><li>家庭能否承担培养成本？</li><li>最差就业出口能否接受？</li></ol></aside>
      <footer><p role="status">{{copyStatus||'历史数据只供讨论，不是录取承诺。'}}</p><button @click="copy">复制纯文本</button></footer>
    </section>
  </div>
</template>

<style scoped>
.family-brief-backdrop{position:fixed;inset:0;z-index:1300;display:grid;place-items:center;padding:24px;background:rgba(15,29,22,.62);backdrop-filter:blur(6px)}
.family-brief{width:min(760px,100%);max-height:calc(100vh - 48px);overflow:auto;border-radius:22px;background:#f8faf6;color:#193126;box-shadow:0 30px 100px rgba(0,0,0,.3)}
.family-brief>header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;padding:24px 28px 18px;background:rgba(248,250,246,.96);border-bottom:1px solid #dce5dd}.family-brief h2{margin:2px 0;font:800 28px 'Noto Serif SC',serif}.family-brief header small{color:#397057;font-weight:800}.family-brief header p{margin:0;color:#68776f;font-size:12px}.family-brief header button{width:38px;height:38px;border:1px solid #d3ddd5;border-radius:50%;background:#fff;font-size:24px;cursor:pointer}
.family-brief-schools{display:grid;gap:12px;padding:20px 28px}.family-brief article{padding:20px;border:1px solid #dce5dd;border-radius:14px;background:#fff}.family-brief article h3{margin:0 0 8px;font-size:20px}.family-brief article>strong{display:block;color:#215b40;line-height:1.6}.family-brief dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0 0}.family-brief dl>div{padding-top:10px;border-top:1px solid #edf1ed}.family-brief dt{color:#77847c;font-size:10px}.family-brief dd{margin:5px 0 0;font-size:12px;line-height:1.65}.family-brief dd span{display:block}
.family-brief aside{margin:0 28px 20px;padding:18px 20px;border-radius:14px;background:#193f30;color:#fff}.family-brief aside ol{margin:10px 0 0;padding-left:20px;line-height:1.9}.family-brief>footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 28px;background:#fff;border-top:1px solid #dce5dd}.family-brief footer p{margin:0;color:#68776f;font-size:11px}.family-brief footer button{min-height:42px;padding:0 18px;border:0;border-radius:9px;background:#d28a31;color:#fff;font-weight:800;cursor:pointer}
@media(max-width:560px){.family-brief-backdrop{padding:0}.family-brief{width:100%;height:100dvh;max-height:none;border-radius:0}.family-brief>header{padding:20px}.family-brief h2{font-size:26px}.family-brief-schools{padding:16px}.family-brief article{padding:18px}.family-brief dl{grid-template-columns:1fr}.family-brief aside{margin:0 16px 16px}.family-brief>footer{padding:14px 16px;flex-direction:column;align-items:stretch}.family-brief footer button{width:100%}}
</style>
