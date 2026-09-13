import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {runPiPrint} from '../pi-print.mjs';
// 写入临时假 pi 脚本（node 直接执行），返回其 spec。
async function makeFixture(dir,body){const file=path.join(dir,'fake-pi-'+Math.random().toString(36).slice(2)+'.mjs');await fs.writeFile(file,body);return {command:process.execPath,args:[file],shell:false};}
test('pi-print：写入 PROMPT.md，传 @PROMPT.md 与 --no-tools，拼接最后一个 assistant message_end 的 text',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-print-'));
 try{
  const spec=await makeFixture(dir,`import fs from 'node:fs';
const argv=process.argv.slice(2);
fs.writeFileSync('argv.json',JSON.stringify(argv));
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'旧结果'}]}});
send({type:'message_end',message:{role:'user',content:[{type:'text',text:'忽略'}]}});
send({type:'message_end',message:{role:'assistant',content:[{type:'thinking',text:'忽略'},{type:'text',text:'hello '},{type:'text',text:'world'}],usage:{input:3,output:2}}});
`);
  const r=await runPiPrint(spec,{cwd:dir,prompt:'测试 prompt',tools:false,timeoutMs:15000});
  assert.equal(r.text,'hello world','取最后一个 assistant message_end，忽略 thinking');
  assert.deepEqual(r.usage,{input:3,output:2});
  assert.equal(await fs.readFile(path.join(dir,'PROMPT.md'),'utf8'),'测试 prompt');
  const argv=JSON.parse(await fs.readFile(path.join(dir,'argv.json'),'utf8'));
  assert.ok(argv.includes('-p')&&argv.includes('--mode')&&argv.includes('json'));
  assert.ok(argv.includes('--no-tools'),'tools=false 应传 --no-tools');
  assert.equal(argv.at(-1),'@PROMPT.md');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('pi-print：tools=true 不传 --no-tools',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-print-'));
 try{
  const spec=await makeFixture(dir,`import fs from 'node:fs';
fs.writeFileSync('argv.json',JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'ok'}]}})+'\\n');
`);
  const r=await runPiPrint(spec,{cwd:dir,prompt:'p',timeoutMs:15000});
  assert.equal(r.text,'ok');
  const argv=JSON.parse(await fs.readFile(path.join(dir,'argv.json'),'utf8'));
  assert.ok(!argv.includes('--no-tools'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('pi-print：非零退出报错并带 stderr 尾部',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-print-'));
 try{
  const spec=await makeFixture(dir,`process.stderr.write('provider 未配置');process.exit(1);`);
  await assert.rejects(()=>runPiPrint(spec,{cwd:dir,prompt:'p',timeoutMs:15000}),/退出码 1.*provider 未配置/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('pi-print：零退出但无文本输出报错',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-print-'));
 try{
  const spec=await makeFixture(dir,`process.stdout.write(JSON.stringify({type:'agent_start'})+'\\n');`);
  await assert.rejects(()=>runPiPrint(spec,{cwd:dir,prompt:'p',timeoutMs:15000}),/未返回文本输出/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('pi-print：超时杀掉进程并以「Pi 任务超时」reject；kill() 可提前终止',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-print-'));
 try{
  const spec=await makeFixture(dir,`setTimeout(()=>{},60000);`);
  await assert.rejects(()=>runPiPrint(spec,{cwd:dir,prompt:'p',timeoutMs:500}),/Pi 任务超时/);
  const hanging=runPiPrint(spec,{cwd:dir,prompt:'p',timeoutMs:15000});
  setTimeout(()=>hanging.kill(),300);
  await assert.rejects(()=>hanging,/退出码/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
