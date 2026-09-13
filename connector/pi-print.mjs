// Pi 原生 print 单发模式执行器：把完整 prompt 写入工作目录 PROMPT.md，
// 以 `pi -p --mode json @PROMPT.md` 启动子进程，stdout 逐行接收 NDJSON 事件，
// 取最后一个 assistant message_end 事件的 text 内容拼接作为结果（thinking 项忽略）。
// 返回的 Promise 附带 kill() 方法，供 runner 取消/停止时杀掉子进程。
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
export function runPiPrint(spec,{cwd,prompt,timeoutMs=600000,tools=true,onEvent}={}){
 let child=null;
 const promise=(async()=>{
  if(!spec?.command)throw Error('缺少 Pi 命令');
  await fs.mkdir(cwd,{recursive:true});
  await fs.writeFile(path.join(cwd,'PROMPT.md'),prompt);
  const args=[...(spec.args||[]),'-p','--mode','json'];
  if(!tools)args.push('--no-tools');
  args.push('@PROMPT.md');
  // Windows 关键：.cmd/.bat 必须 shell:true；一律 windowsHide:true（缺失会导致进程秒退）。
  const shell=!!spec.shell||/\.(cmd|bat)$/i.test(spec.command);
  return await new Promise((resolve,reject)=>{
   let stderr='',errNote='',text=null,usage=null,settled=false;
   const finish=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);fn(v);};
   const timer=setTimeout(()=>{try{child?.kill();}catch{};finish(reject,Error('Pi 任务超时（'+Math.round(timeoutMs/1000)+' 秒）'));},timeoutMs);
   try{child=spawn(spec.command,args,{cwd,shell,windowsHide:true,stdio:['ignore','pipe','pipe']});}
   catch(e){finish(reject,e);return;}
   child.on('error',e=>finish(reject,e));
   child.stderr.on('data',d=>{stderr=(stderr+String(d)).slice(-2000);});
   let buf='';
   child.stdout.on('data',d=>{buf+=String(d);let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let ev;try{ev=JSON.parse(line);}catch{continue;}try{onEvent?.(ev);}catch{}
    if(ev?.type==='error'){const m=ev.error?.message||ev.message;if(m)errNote=String(m);}
    if(ev?.type==='message_end'&&ev.message?.role==='assistant'){const parts=(ev.message.content||[]).filter(c=>c?.type==='text').map(c=>c.text||'');text=parts.join('');if(ev.message.usage)usage=ev.message.usage;}}});
   child.on('close',code=>{
    const tail=(stderr.trim()||errNote).slice(-300);
    if(code!==0){finish(reject,Error('Pi 退出码 '+code+(tail?'：'+tail:'')));return;}
    if(!text){finish(reject,Error('Pi 未返回文本输出'+(tail?'：'+tail:'')));return;}
    const out={text};if(usage)out.usage=usage;finish(resolve,out);
   });
  });
 })();
 promise.kill=()=>{try{child?.kill();}catch{}};
 return promise;
}
