<script setup lang="ts">
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import chinaGeoJson from '../assets/china.json'
import { getProvinceMapData, getSchools, type ProvinceMapData, type School } from '../api'
import { toDatabaseProvinceName, toMapProvinceName } from '../province-names'

const emit = defineEmits<{ back: []; school: [number] }>()
const chartElement = ref<HTMLElement | null>(null)
const provinces = ref<ProvinceMapData[]>([])
const schools = ref<School[]>([])
const selectedProvince = ref('')
const selectedLevel = ref('')
const query = ref('')
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const suggestionsOpen=ref(false)
const activeSuggestion=ref(-1)
const loadedQuery=ref('')
let chart: echarts.ECharts | null = null
let schoolRequest=0
let blurTimer:number|undefined
const totalSchoolCount=computed(()=>provinces.value.reduce((sum,item)=>sum+Number(item.schoolCount),0))
const provinceCount=computed(()=>provinces.value.filter(item=>Number(item.schoolCount)>0).length)
const suggestedSchools=computed(()=>{
  const term=query.value.trim()
  if(!term||loadedQuery.value!==term)return []
  return schools.value.filter(school=>school.name.includes(term)).slice(0,6)
})
const suggestionsLoading=computed(()=>Boolean(query.value.trim())&&loadedQuery.value!==query.value.trim())

async function loadSchools(append=false) {
  if(!append)page.value=1
  const request=++schoolRequest
  const search=query.value.trim()
  const result = await getSchools({ province: selectedProvince.value, level: selectedLevel.value, q: search,page:page.value })
  if(request!==schoolRequest)return
  schools.value = append?[...schools.value,...result.items]:result.items
  total.value = result.total
  loadedQuery.value=search
}
async function loadMore(){if(loadingMore.value||schools.value.length>=total.value)return;loadingMore.value=true;page.value+=1;try{await loadSchools(true)}finally{loadingMore.value=false}}

function renderMap() {
  if (!chartElement.value) return
  echarts.registerMap('china', chinaGeoJson as never)
  chart = echarts.init(chartElement.value)
  chart.setOption({
    tooltip: { trigger: 'item', formatter: ({ name, value }: { name: string; value: number }) => `${name}<br/>高校 ${value || 0} 所` },
    visualMap: { min: 0, max: Math.max(...provinces.value.map(item => item.schoolCount)), left: 18, bottom: 14, text: ['院校多', '院校少'], inRange: { color: ['#eef4ed', '#8db596', '#315d45'] }, textStyle: { color: '#647067' } },
    series: [{ type: 'map', map: 'china', roam: true, zoom: 1.12, selectedMode: 'single', label: { show: true, fontSize: 9, color: '#31433a' }, itemStyle: { areaColor: '#edf2ec', borderColor: '#fff', borderWidth: 1 }, emphasis: { itemStyle: { areaColor: '#d5a15c' } }, data: provinces.value.map(item => ({ name: toMapProvinceName(item.name), value: item.schoolCount })) }],
  })
  chart.on('click', ({ name }: { name: string }) => { selectedProvince.value = toDatabaseProvinceName(name); void loadSchools() })
}

onMounted(async () => {
  provinces.value = await getProvinceMapData()
  await loadSchools()
  loading.value = false
  await nextTick()
  renderMap()
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => { window.removeEventListener('resize', resize); window.clearTimeout(timer);window.clearTimeout(blurTimer);chart?.dispose() })
watch(selectedLevel,()=>void loadSchools())
let timer: number | undefined
watch(query, value => { activeSuggestion.value=-1;suggestionsOpen.value=Boolean(value.trim());window.clearTimeout(timer);timer=window.setTimeout(()=>void loadSchools(),280) })
function resize() { chart?.resize() }
function clearProvince() { selectedProvince.value = ''; chart?.dispatchAction({ type: 'unselect', seriesIndex: 0 }); void loadSchools() }
function openSuggestions(){window.clearTimeout(blurTimer);if(query.value.trim())suggestionsOpen.value=true}
function closeSuggestions(){blurTimer=window.setTimeout(()=>{suggestionsOpen.value=false;activeSuggestion.value=-1},120)}
async function selectSuggestion(school:School){query.value=school.name;await nextTick();suggestionsOpen.value=false;activeSuggestion.value=-1;window.clearTimeout(timer);await loadSchools()}
function onSearchKeydown(event:KeyboardEvent){
  if(event.key==='Escape'){suggestionsOpen.value=false;activeSuggestion.value=-1;return}
  if(!suggestionsOpen.value||!suggestedSchools.value.length)return
  if(event.key==='ArrowDown'){event.preventDefault();activeSuggestion.value=(activeSuggestion.value+1)%suggestedSchools.value.length}
  else if(event.key==='ArrowUp'){event.preventDefault();activeSuggestion.value=(activeSuggestion.value-1+suggestedSchools.value.length)%suggestedSchools.value.length}
  else if(event.key==='Enter'&&activeSuggestion.value>=0){event.preventDefault();void selectSuggestion(suggestedSchools.value[activeSuggestion.value]!)}
}
</script>

<template>
  <div class="map-page">
    <header class="map-head"><div><span class="kicker">全国院校库 · 2026</span><h2>从地图开始看学校</h2><p>点击省份查看院校分布，再按层次与名称缩小范围。</p></div><button class="secondary-action" @click="emit('back')">返回规划</button></header>
    <div v-if="loading" class="loading-panel"><span class="spinner"></span><p>正在加载全国院校数据…</p></div>
    <template v-else>
      <section class="map-layout"><div ref="chartElement" class="china-map"></div><aside class="map-stat"><strong>{{totalSchoolCount.toLocaleString()}}</strong><span>教育部普通高校</span><div><b>{{provinceCount}}</b><small>省级地区</small></div><div><b>{{ selectedProvince ? total : '全国' }}</b><small>{{ selectedProvince || '当前范围' }}</small></div><p>数据截至 2026 年 6 月 17 日，来源为教育部公开名单。</p></aside></section>
      <section class="school-browser">
        <div class="filter-row"><div class="province-chip" :class="{ active: selectedProvince }">{{ selectedProvince || '全国' }}<button v-if="selectedProvince" @click="clearProvince">×</button></div><div class="school-search"><input v-model="query" role="combobox" aria-label="搜索院校或城市" aria-autocomplete="list" aria-controls="school-search-suggestions" :aria-expanded="suggestionsOpen" :aria-activedescendant="activeSuggestion>=0?`school-suggestion-${suggestedSchools[activeSuggestion]?.id}`:undefined" placeholder="搜索院校或城市" @focus="openSuggestions" @blur="closeSuggestions" @keydown="onSearchKeydown"/><Transition name="school-suggestions"><div v-if="suggestionsOpen" id="school-search-suggestions" class="school-suggestions" role="listbox" aria-label="院校搜索建议"><p v-if="suggestionsLoading">正在查找院校…</p><template v-else-if="suggestedSchools.length"><button v-for="(school,index) in suggestedSchools" :id="`school-suggestion-${school.id}`" :key="school.id" type="button" role="option" :aria-selected="index===activeSuggestion" :class="{active:index===activeSuggestion}" @mouseenter="activeSuggestion=index" @mousedown.prevent="selectSuggestion(school)"><strong>{{school.name}}</strong><span>{{school.city}} · {{school.level}}</span></button></template><p v-else>没有匹配的学校名称</p></div></Transition></div><select v-model="selectedLevel"><option value="">全部层次</option><option>985</option><option>211</option><option>本科</option><option>专科</option></select><span>找到 {{ total }} 所</span></div>
        <div class="school-grid"><button v-for="school in schools" :key="school.id" type="button" :aria-label="`查看 ${school.name} 详情`" @click="emit('school',school.id)"><span :class="['school-level', school.level]">{{ school.level }}</span><h3>{{ school.name }}</h3><p>{{ school.province }} · {{ school.city }} · {{ school.schoolType }}</p><i>查看详情 →</i></button></div>
        <button v-if="schools.length<total" class="school-load-more" :disabled="loadingMore" @click="loadMore">{{loadingMore?'正在加载…':`加载更多 · 还有 ${total-schools.length} 所`}}</button>
      </section>
    </template>
  </div>
</template>
