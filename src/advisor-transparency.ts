export type AdvisorTransparency={
  confirmed:string
  unknown:string
  nextStep:string
  detail:string
}

export function parseAdvisorTransparency(content:string):AdvisorTransparency|null{
  const lines=plainAdvisorText(content).replace(/\r\n/g,'\n').split('\n')
  const confirmed=readLine(lines[0],'现在能确定：')
  const unknown=readLine(lines[1],'现在还不能确定：')
  const nextStep=readLine(lines[2],'下一步只做：')
  if(!confirmed||!unknown||!nextStep)return null
  return {confirmed,unknown,nextStep,detail:lines.slice(3).join('\n').trim()}
}

export function plainAdvisorText(content:string){
  return content
    .replace(/^#{1,6}\s+/gm,'')
    .replace(/```/g,'')
    .replace(/\*\*|__/g,'')
    .replace(/`([^`]+)`/g,'$1')
}

function readLine(line:string|undefined,prefix:string){
  if(!line?.startsWith(prefix))return ''
  return line.slice(prefix.length).trim()
}
