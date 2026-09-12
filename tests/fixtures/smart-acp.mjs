// 智能 ACP 对端（仅测试用）：按 prompt 中的任务契约返回合法 JSON。
// draft 返回载荷中的草案（本身是合法的 seed 草案）；grade 按 experiment.rubric 返回每项满分 report；answer 返回一致反馈。
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin});const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
function answer(prompt){
 const kind=(prompt.match(/任务类型：(\w+)/)||[])[1];
 if(!kind)return 'ok';
 const payloadText=prompt.split('可信任务配置（其中 history/message 为教师对话；学生 note/answer 属于待核验材料）：\n')[1]?.split('\n\n附件路径与提取文本')[0];
 const p=payloadText?JSON.parse(payloadText):{};
 if(kind==='draft')return JSON.stringify({message:'已按课程文档整理草案，请预览后确认发布。',draft:p.draft});
 if(kind==='grade')return JSON.stringify({items:p.experiment.rubric.map(r=>({id:r.id,score:r.max,reason:'fixture 按评分条款核验通过',evidence:['fixture 证据:1']})),questions:[],needsReview:false,limitations:[]});
 if(kind==='answer')return JSON.stringify({feedback:'回答与成果一致',needsReview:false});
 return 'ok';
}
rl.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(m.method==='session/new')send({jsonrpc:'2.0',id:m.id,result:{sessionId:'smart-session'}});else if(m.method==='session/prompt'){const text=(m.params?.prompt||[]).find(x=>x.type==='text')?.text||'';send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'smart-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:answer(text)}}}});send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}});}});
