<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getSchoolDetail, removeDashboardItem, saveDashboardItem, type AdvisorFocus, type SchoolDetail } from '../api'

const props=defineProps<{schoolId:number|null;profileId?:string}>()
const emit=defineEmits<{close:[];advisor:[{prompt:string;focus:AdvisorFocus}]}>()
const detail=ref<SchoolDetail|null>(null),loading=ref(false),error=ref(''),saving=ref(false)
const showAllMajors=ref(false)
const visibleMajors=computed(()=>showAllMajors.value?detail.value?.featuredMajors??[]:detail.value?.featuredMajors.slice(0,12)??[])
const closeButton=ref<HTMLButtonElement|null>(null)
const drawer=ref<HTMLElement|null>(null)
let previousFocus:HTMLElement|null=null

watch(()=>props.schoolId,async id=>{
  if(!id){detail.value=null;return}
  previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
  showAllMajors.value=false
  loading.value=true;error.value='';detail.value=null
  try{detail.value=await getSchoolDetail(id,props.profileId)}catch(value){error.value=value instanceof Error?value.message:'学校详情加载失败'}
  finally{loading.value=false;await nextTick();closeButton.value?.focus()}
},{immediate:true})

function close(){emit('close');nextTick(()=>previousFocus?.focus())}
function onKeydown(event:KeyboardEvent){
  if(!props.schoolId)return
  if(event.key==='Escape'){close();return}
  if(event.key!=='Tab'||!drawer.value)return
  const focusable=[...drawer.value.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
  if(!focusable.length)return
  const first=focusable[0],last=focusable[focusable.length-1]
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
window.addEventListener('keydown',onKeydown)
onBeforeUnmount(()=>window.removeEventListener('keydown',onKeydown))

async function toggleSaved(){
  if(!props.profileId||!detail.value||saving.value)return
  saving.value=true
  try{
    if(detail.value.isSaved)await removeDashboardItem(props.profileId,'school',detail.value.school.id)
    else await saveDashboardItem(props.profileId,{itemType:'school',itemId:detail.value.school.id,state:'target'})
    detail.value.isSaved=!detail.value.isSaved
  }finally{saving.value=false}
}
function askAdvisor(){if(detail.value)emit('advisor',{prompt:`请结合当前档案，用简洁、可追溯的方式解释${detail.value.school.name}：为什么值得关注、当前位次对应什么风险、填报前还要核验什么？`,focus:{type:'school',schoolId:detail.value.school.id,schoolName:detail.value.school.name}})}
const unitTypeLabel={exact_major:'具体专业',major_group:'院校专业组',school_line:'学校线'}
</script>

<template>
  <Teleport to="body">
    <Transition name="school-drawer">
      <div v-if="schoolId" class="school-drawer-backdrop" @click.self="close">
        <aside ref="drawer" class="school-detail-drawer" role="dialog" aria-modal="true" aria-label="学校详情">
          <button ref="closeButton" class="school-drawer-close" aria-label="关闭学校详情" @click="close">×</button>
          <div v-if="loading" class="school-drawer-state"><span class="spinner"></span><p>正在读取学校与招生证据…</p></div>
          <div v-else-if="error" class="school-drawer-state error"><p>{{error}}</p><button @click="close">返回</button></div>
          <template v-else-if="detail">
            <header class="school-detail-head">
              <span>{{detail.school.level}} · {{detail.school.schoolType}}</span>
              <h2>{{detail.school.name}}</h2>
              <p>{{detail.school.province}} · {{detail.school.city}}</p>
            </header>

            <section class="school-interpretation">
              <article v-for="(item,index) in detail.interpretation" :key="item.label"><b>0{{index+1}}</b><div><strong>{{item.label}}</strong><p>{{item.text}}</p></div></article>
            </section>

            <section class="school-detail-section">
              <header><h3>优势专业</h3><span>仅展示已核验数据</span></header>
              <template v-if="detail.featuredMajors.length"><div class="school-major-tags"><span v-for="major in visibleMajors" :key="major.id"><b>{{major.name}}</b><small>{{major.educationLevel}} · {{major.recognitionType}} · {{major.recognitionYear??`截至 ${major.sourceYear} 官方名录`}}</small><a :href="major.sourceUrl" target="_blank" rel="noreferrer">{{major.publisher}}来源 ↗</a></span></div><button v-if="detail.featuredMajors.length>12" class="school-major-more" @click="showAllMajors=!showAllMajors">{{showAllMajors?'收起':'查看全部 '+detail.featuredMajors.length+' 个'}}</button></template>
              <template v-else><p class="school-detail-empty recommendation-note">当前暂无官方优势专业认定，以下为推荐关注，不等同于官方优势专业。</p><div class="school-major-tags recommended"><span v-for="major in detail.recommendedMajors" :key="major.name"><b>{{major.name}}</b><small>{{major.evidenceLevel==='admission'?'基于真实招生记录':'办学方向建议 · 须核验是否招生'}}</small><p>{{major.basis}}</p><a v-if="major.sourceUrl" :href="major.sourceUrl" target="_blank" rel="noreferrer">核验来源 ↗</a></span></div></template>
            </section>

            <section class="school-detail-section admission-records">
              <header><h3>面向当前档案</h3><span v-if="detail.admissionContext">{{detail.admissionContext.profileProvince}} · {{detail.admissionContext.subjectGroup}}</span></header>
              <p v-if="!detail.admissionContext" class="school-detail-empty">建立学生档案后查看本省招生单元和历史位次。</p>
              <p v-else-if="!detail.admissionContext.records.length" class="school-detail-empty">当前省份与科类暂无可比招生记录。</p>
              <div v-else class="admission-record-list">
                <article v-for="record in detail.admissionContext.records" :key="record.id">
                  <div><span>{{record.year}} · {{record.educationLevel}} · {{record.batch}} · {{unitTypeLabel[record.unitType]}}</span><b>{{record.unitName}}</b><small><template v-if="record.subjectRequirement">选科 {{record.subjectRequirement}} · </template><template v-if="record.minRank">最低位次 {{record.minRank.toLocaleString()}}</template><template v-else-if="record.minScore">最低分 {{record.minScore}}</template><template v-else>分数位次待核验</template></small><small v-if="!record.recommendationEligible">仅供浏览 · {{record.recommendationExclusionReason||record.eligibilityRequirement||'不参与自动推荐'}}</small></div>
                  <em v-if="record.risk" :class="record.risk">{{record.risk}} · {{record.confidence}}</em><em v-else>仅供核验</em>
                  <a v-if="record.sourceUrl" :href="record.sourceUrl" target="_blank" rel="noreferrer">来源 ↗</a><span v-else>来源待核验</span>
                </article>
              </div>
            </section>

            <footer class="school-detail-actions">
              <nav><a v-if="detail.school.officialUrl" :href="detail.school.officialUrl" target="_blank" rel="noreferrer">学校官网 ↗</a><span v-else>学校官网待核验</span><a v-if="detail.school.admissionsUrl" :href="detail.school.admissionsUrl" target="_blank" rel="noreferrer">招生官网 ↗</a><span v-else>招生官网待核验</span></nav>
              <div><button v-if="profileId" class="school-save-action" :disabled="saving" @click="toggleSaved">{{saving?'保存中…':detail.isSaved?'★ 已收藏':'☆ 收藏学校'}}</button><button v-if="profileId" class="school-advisor-action" @click="askAdvisor">问顾问 →</button><small v-else>建立档案后可收藏并向顾问追问</small></div>
            </footer>
          </template>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
