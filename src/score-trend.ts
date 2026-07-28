export type ScoreCoordinate={score:number|null;provinceRank:number|null}

export function describeScoreTrend(snapshots:ScoreCoordinate[]){
  if(snapshots.length<2)return '还只有一个坐标，先记录，不下趋势结论'
  const previous=snapshots.at(-2)!,current=snapshots.at(-1)!
  if(previous.provinceRank==null||current.provinceRank==null)return '只有分数：不同考试难度不可直接比较'
  const difference=previous.provinceRank-current.provinceRank
  if(difference===0)return '位次与上次持平'
  return `位次${difference>0?'前进':'回落'} ${Math.abs(difference).toLocaleString('zh-CN')} 名`
}
