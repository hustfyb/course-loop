// 智能 pi print 模式对端（仅测试用）：读 argv 中的 @文件 作为 prompt，按任务契约往 stdout 写 NDJSON。
// draft 返回载荷中的草案（本身是合法的 seed 草案）；grade 按 experiment.rubric 返回每项满分 report；answer 返回一致反馈。
// 同时把收到的 argv 追加记录到 FAKE_PI_LOG（JSON Lines），供测试断言 @PROMPT.md 与 --no-tools 的传递。
import fs from 'node:fs';
import path from 'node:path';
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
const argv=process.argv.slice(2);
const at=argv.find(a=>a.startsWith('@'));
const promptPath=at?path.resolve(process.cwd(),at.slice(1)):null;
const prompt=promptPath&&fs.existsSync(promptPath)?fs.readFileSync(promptPath,'utf8'):'';
if(process.env.FAKE_PI_LOG)fs.appendFileSync(process.env.FAKE_PI_LOG,JSON.stringify({argv,promptFile:at||null,promptExists:!!prompt,noTools:argv.includes('--no-tools')})+'\n');
const text=answer(prompt);
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
send({type:'session',id:'fake-session'});
send({type:'agent_start'});
send({type:'message_end',message:{role:'user',content:[{type:'text',text:'应被忽略：role 不是 assistant'}]}});
send({type:'message_end',message:{role:'assistant',content:[{type:'thinking',text:'应被忽略：thinking 项'},{type:'text',text}],usage:{input:10,output:5}}});
