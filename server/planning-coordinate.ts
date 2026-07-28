import type {RowDataPacket} from 'mysql2'
import {database} from './database.js'

export type PlanningStability='single'|'preliminary'|'stable'|'moderate'|'volatile'
export type PlanningCoordinate={rank:number|null;sampleCount:number;bestRank:number|null;worstRank:number|null;spreadRatio:number|null;stability:PlanningStability}

export function calculatePlanningCoordinate(rawRanks:Array<number|null|undefined>):PlanningCoordinate{
  const ranks=rawRanks.filter((rank):rank is number=>Number.isInteger(rank)&&Number(rank)>0).slice(0,5)
  if(!ranks.length)return {rank:null,sampleCount:0,bestRank:null,worstRank:null,spreadRatio:null,stability:'single'}
  const sorted=[...ranks].sort((a,b)=>a-b)
  const middle=Math.floor(sorted.length/2)
  const rank=sorted.length%2?sorted[middle]:Math.round((sorted[middle-1]+sorted[middle])/2)
  const bestRank=sorted[0],worstRank=sorted.at(-1)!
  const spreadRatio=Number(((worstRank-bestRank)/rank).toFixed(3))
  const stability:PlanningStability=sorted.length===1?'single':sorted.length===2?'preliminary':spreadRatio<=.1?'stable':spreadRatio<=.25?'moderate':'volatile'
  return {rank,sampleCount:sorted.length,bestRank,worstRank,spreadRatio,stability}
}

export async function loadPlanningCoordinate(profileId:string,fallbackRank:number|null=null){
  const [rows]=await database.query<RowDataPacket[]>(`SELECT province_rank provinceRank FROM profile_score_snapshots WHERE profile_id=? AND province_rank IS NOT NULL ORDER BY exam_date DESC,id DESC LIMIT 5`,[profileId])
  const ranks=rows.map(row=>Number(row.provinceRank))
  return calculatePlanningCoordinate(ranks.length?ranks:[fallbackRank])
}
