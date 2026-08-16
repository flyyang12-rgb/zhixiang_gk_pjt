import {describe,expect,it} from 'vitest'
import {buildLocalAdvisorReply,type AdvisorReplyContext} from '../server/advisor-reply'

function expectTransparent(answer:string){
  expect(answer).toMatch(/^现在能确定：\S.+\n现在还不能确定：\S.+\n下一步只做：\S.+/)
  const nextStep=answer.match(/^下一步只做：(.+)$/m)?.[1]??''
  expect(nextStep).not.toMatch(/(?:^|[；;])\s*[二三四五六七八九\d][、.．]/)
  expect(answer).not.toMatch(/综合参考分|低置信度|本科直接就业入口分/)
}

function context():AdvisorReplyContext{
  const computer={id:1,name:'计算机科学与技术',band:'优先了解',totalScore:75,factors:{directEntry:{value:100,evidence:'三个审核岗位方向中，本科可直接进入比例 100%'}}}
  return {
    profile:{studentName:'小智',province:'河南',subjectGroup:'物理类',score:500,provinceRank:105545},
    dashboard:{cards:[computer],employment:{usable:false}} as unknown as AdvisorReplyContext['dashboard'],
    focusedMajor:null,
    schoolDetail:{
      school:{id:1,name:'河南牧业经济学院',province:'河南',city:'郑州',level:'本科',schoolType:'公办',features:{},officialUrl:null,admissionsUrl:null,linksVerifiedAt:null,linksSourceUrl:null},
      featuredMajors:[],
      recommendedMajors:[],
      admissionContext:{profileProvince:'河南',subjectGroup:'物理类',provinceRank:105545,years:[],records:[]},
      interpretation:[],
      isSaved:false,
    },
  }
}

describe('顾问院校问答语气',()=>{
  it('把家庭备注当作用户条件，不冒充官方事实或偷改排序',()=>{
    const current=context()
    current.dashboard.savedItems=[{itemType:'school',itemId:1,state:'target',note:'父母最担心培养成本'}]
    const answer=buildLocalAdvisorReply(current,'这学校值不值得看')
    expect(answer).toContain('家庭讨论备注')
    expect(answer).toContain('不是官方事实')
    expect(answer).toContain('不会偷改排序')
  })
  it('直接回答院校怎么样，并接住用户的地域信息',()=>{
    const answer=buildLocalAdvisorReply(context(),'河南牧业经济学院怎么样，我是河南南阳人')
    expectTransparent(answer)
    expect(answer).toContain('不建议现在把河南牧业经济学院放在前面')
    expect(answer).toContain('南阳人')
    expect(answer).toContain('离家近是加分项，不是报考理由')
    expect(answer).toContain('你最想学什么专业')
    expect(answer).not.toContain('【先说结论】')
    expect(answer).not.toContain('接下来怎么查')
    expect(answer).not.toContain('招聘样本')
  })

  it('院校评价第一行先亮态度，允许骂错误选择但不骂用户',()=>{
    const answer=buildLocalAdvisorReply(context(),'河南牧业经济学院到底值不值得报')
    expect(answer.split('\n')[0]).toContain('不建议现在把河南牧业经济学院放在前面')
    expect(answer).toContain('这叫瞎报，不叫规划')
    expect(answer).not.toMatch(/你(?:真|太)?(?:蠢|笨|没出息)|你家穷/)
  })

  it('没有目标专业证据时直接劝退，不拿校名糊弄家庭',()=>{
    const answer=buildLocalAdvisorReply(context(),'我想学计算机科学与技术，这学校怎么样')
    expect(answer).toContain('不建议现在把河南牧业经济学院当成计算机科学与技术的核心目标')
    expect(answer).toContain('拿专业去赌')
    expect(answer).toContain('下一步只做：查看该校当年招生专业目录')
  })

  it('“那它的会计怎么样”继续核对专业，不退回学校通稿',()=>{
    const answer=buildLocalAdvisorReply(context(),'那它的会计怎么样')
    expect(answer).toContain('河南牧业经济学院')
    expect(answer).toContain('会计')
    expect(answer).toContain('不建议现在把河南牧业经济学院当成会计的核心目标')
    expect(answer).not.toContain('离家近是加分项')
  })

  it.each([
    ['你好','你好，我在','【先说结论】'],
    ['谢谢，我明白了','能听明白就行','全省位次'],
    ['家里最多承担四年本科，先记住','记住了','【先说结论】'],
    ['我现在很迷茫，不知道怎么办','怕的不是纠结','【为什么这么说】'],
    ['这个专业是不是必须考研','别把考研当成默认答案','【接下来怎么查】'],
    ['计算机科学与技术就业怎么样','有岗位，不等于普通本科生一定够得着','【先说结论】'],
    ['到底优先选学校还是专业','我的态度很明确，先保想学的专业，再选学校','【这事最容易踩的坑】'],
  ])('不同问题都先接当前这句话：%s',(question,expected,mechanicalHeading)=>{
    const current=context()
    current.schoolDetail=null
    const answer=buildLocalAdvisorReply(current,question)
    expect(answer).toContain(expected)
    expect(answer).not.toContain(mechanicalHeading)
  })

  it.each([
    ['这个专业是不是必须考研',false],
    ['计算机科学与技术就业怎么样',false],
    ['到底优先选学校还是专业',false],
    ['我能报计算机吗？',false],
    ['这学校在哪',true],
    ['这学校学费贵不贵',true],
    ['这学校宿舍怎么样',true],
  ])('决策与事实问题使用透明三句话：%s',(question,keepSchool)=>{
    const current=context()
    if(!keepSchool)current.schoolDetail=null
    expectTransparent(buildLocalAdvisorReply(current,question))
  })

  it('口语问法不会把语气词识别进专业名称',()=>{
    const current=context();current.schoolDetail=null
    const answer=buildLocalAdvisorReply(current,'我能报计算机吗？')
    expect(answer).toContain('计算机')
    expect(answer).not.toContain('计算机吗')
  })

  it.each(['你好','谢谢，我明白了','你是谁','家里最多承担四年本科，先记住','我现在很迷茫，不知道怎么办'])('自然对话不强套透明三句话：%s',question=>{
    const answer=buildLocalAdvisorReply(context(),question)
    expect(answer).not.toContain('现在能确定：')
    expect(answer).not.toContain('现在还不能确定：')
    expect(answer).not.toContain('下一步只做：')
  })

  it('普通兜底也不再退回万能四段报告',()=>{
    const current=context()
    current.schoolDetail=null
    const answer=buildLocalAdvisorReply(current,'我们家现在到底该先做什么')
    expect(answer).toContain('先守住能录取的范围')
    expect(answer).toContain('最想先解决学校、专业还是就业')
    expect(answer).not.toContain('【先说结论】')
    expect(answer).not.toContain('1. 找到目标专业')
    expectTransparent(answer)
  })

  it('院校焦点下的综合判断也使用透明三句话',()=>{
    const answer=buildLocalAdvisorReply(context(),'帮我梳理一下这所学校最大的风险')
    expectTransparent(answer)
    expect(answer).not.toContain('【先说结论】')
  })

  it.each([
    ['这学校在哪','河南郑州'],
    ['这学校学费贵不贵','不能张嘴报数'],
    ['这学校宿舍怎么样','没有收录河南牧业经济学院的住宿条件'],
  ])('学校具体事实只回答当前这一项：%s',(question,expected)=>{
    const answer=buildLocalAdvisorReply(context(),question)
    expect(answer).toContain(expected)
    expect(answer).not.toContain('先把河南牧业经济学院放在')
    expect(answer).not.toContain('【接下来怎么查】')
  })
})
