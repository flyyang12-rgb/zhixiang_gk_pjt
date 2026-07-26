<script setup lang="ts">
import { computed,onMounted,ref } from 'vue'
import { getSchoolDataQuality,type SchoolDataQuality } from '../api'

const data=ref<SchoolDataQuality|null>(null),loading=ref(true),error=ref(''),query=ref(''),page=ref(1)
const cards=computed(()=>data.value?[['学校官网',data.value.summary.officialWebsite],['招生官网',data.value.summary.admissionsWebsite],['优势专业',data.value.summary.featuredMajors],['招生年份',data.value.summary.admissionYears]]:[])
onMounted(load)
async function load(){loading.value=true;error.value='';try{data.value=await getSchoolDataQuality({page:page.value,pageSize:24,q:query.value.trim()||undefined})}catch(value){error.value=value instanceof Error?value.message:'数据核验状态加载失败'}finally{loading.value=false}}
async function search(){page.value=1;await load()}
async function changePage(offset:number){if(!data.value)return;page.value=Math.max(1,page.value+offset);await load()}
</script>

<template><main class="data-quality-admin"><header><div><span>LOCAL DATA MAINTENANCE</span><h1>院校数据核验</h1><p>仅供本机数据维护。覆盖率来自当前 MySQL，未核验事实不会进入普通用户详情。</p></div><a href="/">返回知向工作台 →</a></header><section v-if="data" class="quality-summary"><article v-for="card in cards" :key="card[0] as string"><span>{{card[0]}}</span><b>{{(card[1] as {verified:number}).verified.toLocaleString()}}</b><small>已核验 · 缺失 {{(card[1] as {missing:number}).missing.toLocaleString()}}</small></article></section><form class="quality-search" @submit.prevent="search"><input v-model="query" placeholder="按院校或城市筛选待核验项"><button>查询</button></form><div v-if="loading" class="quality-state">正在读取数据库覆盖率…</div><div v-else-if="error" class="quality-state error"><p>{{error}}</p><button @click="load">重试</button></div><section v-else-if="data" class="quality-list"><header><strong>待核验院校</strong><span>{{data.totalPending.toLocaleString()}} 所</span></header><article v-for="item in data.items" :key="item.id"><div><b>{{item.name}}</b><span>{{item.province}} · {{item.city}} · {{item.level}}</span></div><ul><li v-for="gap in item.missing" :key="gap">{{gap}}</li></ul><small>{{item.linksVerifiedAt?`链接最近核验 ${new Date(item.linksVerifiedAt).toLocaleDateString('zh-CN')}`:'尚无链接核验时间'}}</small></article><footer><button :disabled="page===1" @click="changePage(-1)">上一页</button><span>第 {{page}} 页</span><button :disabled="page*data.pageSize>=data.totalPending" @click="changePage(1)">下一页</button></footer></section><aside><b>安全导入边界</b><p>自动发现只生成候选和报告。只有学校身份、官方来源与页面内容核验通过后，才可导入用户可见数据库；失败不得覆盖已有有效事实。</p><code>npm run data:school-links:auto</code></aside></main></template>
