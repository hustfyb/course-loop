// 自托管 Node 服务器测试：DB 封装与幂等迁移、Pi 扫描、探测、端到端流程、未安装 Pi 时的健康状态。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createDb,migrate,wrapD1,localFiles,findPi,probePi,startServer} from '../server/node-server.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const smartFixture=path.join(here,'fixtures','smart-pi.mjs');
const brokenFixture=path.join(here,'fixtures','broken-pi.mjs');
const drizzleDir=path.resolve(here,'..','drizzle');
// 生成临时 bin 目录，内置 pi 启动包装（Windows 下为 pi.cmd）。
// fixture 复制进纯 ASCII 的临时目录：cmd.exe 按 ANSI 码页解析批处理，中文路径会乱码。
async function makeFakePiBin(fixture){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-bin-'));
 const local=path.join(dir,'fake-pi.mjs');
 await fs.copyFile(fixture,local);
 if(process.platform==='win32')await fs.writeFile(path.join(dir,'pi.cmd'),`@"${process.execPath}" "%~dp0fake-pi.mjs" %*\r\n`);
 else{await fs.writeFile(path.join(dir,'pi'),`#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-pi.mjs" "$@"\n`);await fs.chmod(path.join(dir,'pi'),0o755);}
 return dir;
}
// 读取 fixture 记录的调用日志（FAKE_PI_LOG，JSON Lines）。
async function readPiLog(logFile){return (await fs.readFile(logFile,'utf8')).trim().split('\n').map(l=>JSON.parse(l));}
async function until(fn,timeoutMs=90000,step=250){const end=Date.now()+timeoutMs;let last;while(Date.now()<end){last=await fn();if(last)return last;await new Promise(r=>setTimeout(r,step));}throw Error('等待超时：'+JSON.stringify(last));}
test('DB 封装 + 幂等迁移：连跑两次不报错，batch 事务可回滚',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'course-loop-db-'));
 const expectedMigrations=(await fs.readdir(drizzleDir)).filter(f=>f.endsWith('.sql')).length;
 const sqlite=createDb(dir);
 try{
  await migrate(sqlite,drizzleDir);await migrate(sqlite,drizzleDir);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM __migrations').get().n,expectedMigrations);
  const db=wrapD1(sqlite);
  await db.prepare("INSERT INTO settings VALUES('k','v') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key=?").bind('k').first()).value,'v');
  await db.batch([db.prepare("INSERT INTO settings VALUES('b1','x')").bind(),db.prepare("INSERT INTO settings VALUES('b2','y')").bind()]);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM settings").first()).n,3);
  await assert.rejects(()=>db.batch([db.prepare("INSERT INTO settings VALUES('b3','z')").bind(),db.prepare("INSERT INTO settings VALUES('k','dupe')").bind()]));
  assert.equal(await db.prepare("SELECT value FROM settings WHERE key='b3'").first(),null,'失败 batch 应整体回滚');
 }finally{sqlite.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
test('FILES 本地目录：put/get/delete',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'course-loop-files-'));
 try{const files=localFiles(dir);await files.put('abc-123',Buffer.from('hello'));const obj=await files.get('abc-123');assert.equal(Buffer.from(obj.body).toString(),'hello');await files.delete('abc-123');assert.equal(await files.get('abc-123'),null);assert.equal(await files.get('不存在'),null);}
 finally{await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
test('Pi 扫描：PATH 中的假 pi 可被发现，空 PATH 未找到',async()=>{
 const bin=await makeFakePiBin(smartFixture);
 try{
  const found=await findPi({pathEnv:bin+path.delimiter+process.env.PATH});
  assert.ok(found,'应扫描到假 pi');
  assert.match(found.command,/pi(\.cmd)?$/i);
  if(process.platform==='win32')assert.equal(found.shell,true,'.cmd 需要 shell');
  const empty=await fs.mkdtemp(path.join(os.tmpdir(),'pi-empty-'));
  try{assert.equal(await findPi({pathEnv:empty}),null,'空 PATH 应未找到');}
  finally{await fs.rm(empty,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
 }finally{await fs.rm(bin,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
test('探测：正常 fixture 在线且 acpError 为空；provider 配置错误 fixture 离线且有错误',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'pi-probe-'));
 const logFile=path.join(work,'pi-calls.log');process.env.FAKE_PI_LOG=logFile;
 try{
  const good=await probePi({command:process.execPath,args:[smartFixture],shell:false},{cwd:work,timeoutMs:15000});
  assert.deepEqual(good,{ok:true});
  // print 模式断言：fixture 收到 @PROMPT.md 且文件存在；探测（tools=false）带 --no-tools
  const calls=await readPiLog(logFile);
  assert.equal(calls.length,1);assert.equal(calls[0].promptFile,'@PROMPT.md');assert.equal(calls[0].promptExists,true);assert.equal(calls[0].noTools,true,'探测应禁用工具');
  assert.equal(await fs.readFile(path.join(work,'PROMPT.md'),'utf8'),'请只回复 ok','prompt 应写入工作目录 PROMPT.md');
  const bad=await probePi({command:process.execPath,args:[brokenFixture],shell:false},{cwd:work,timeoutMs:15000});
  assert.equal(bad.ok,false);assert.match(bad.error,/provider/);assert.ok(bad.error.length<=300);
 }finally{delete process.env.FAKE_PI_LOG;await fs.rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
// 端到端 HTTP 助手
async function call(base,url,data,cookie){const r=await fetch(base+'/api/'+url,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined||data instanceof FormData?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)});const type=r.headers.get('content-type');const setCookie=r.headers.getSetCookie?.()[0];return {status:r.status,data:type?.includes('json')?await r.json():await r.arrayBuffer(),cookie:setCookie?setCookie.split(';')[0]:undefined};}
async function login(base,em,role){assert.equal((await call(base,'auth/request',{email:em})).status,200);const r=await call(base,'auth/verify',{email:em,code:'123456'});assert.equal(r.status,200,JSON.stringify(r.data));let user=r.data.user;if(user.role==='pending'&&role){const body={role,name:em.split('@')[0]};if(role==='student')body.studentNo='2026001';const p=await call(base,'auth/profile',body,r.cookie);assert.equal(p.status,200,JSON.stringify(p.data));user=p.data.user;}return {cookie:r.cookie,user};}
const testEnv={ADMIN_EMAILS:'admin@example.com',LOCAL_DEV:'1',DEV_EMAIL_CODE:'123456'};
test('端到端：进程内 runner 完成 draft 与 grade 任务；SMTP 未配置时 mail 离线且不投递',async()=>{
 const bin=await makeFakePiBin(smartFixture);
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'course-loop-e2e-'));
 const logFile=path.join(dataDir,'pi-calls.log');process.env.FAKE_PI_LOG=logFile;
 const app=await startServer({port:0,host:'127.0.0.1',dataDir,env:testEnv,pathEnv:bin+path.delimiter+process.env.PATH,pollIntervalMs:200,scanIntervalMs:0,probeTimeoutMs:15000,clientDir:path.join(dataDir,'no-client'),serverEntry:null,log:()=>{}});
 try{
  const base=`http://127.0.0.1:${app.port}`;
  assert.equal((await fetch(base+'/')).status,503,'dist/client 缺失时应提示先 build');
  const admin=await login(base,'admin@example.com');
  // 探测成功后 health.acp 在线、acpError 为空
  await until(async()=>{const s=(await call(base,'state',undefined,admin.cookie)).data;return s.health?.acp===true?s:null;},30000);
  // 管理员建课 → 对话生成草案（draft 任务经进程内 runner 完成）→ 发布
  const cid=(await call(base,'courses',{},admin.cookie)).data.id;
  assert.equal((await call(base,'chat',{courseId:cid,message:'请整理课程',fileIds:[]},admin.cookie)).status,200);
  await until(async()=>{const s=(await call(base,'state',undefined,admin.cookie)).data;const j=s.jobs?.[0];if(j?.status==='failed')throw Error('draft 任务失败：'+j.error);return j?.status==='complete'?s:null;});
  const rev=(await call(base,'state',undefined,admin.cookie)).data.courses.find(c=>c.id===cid).revision;
  const pub=await call(base,'publish',{courseId:cid,revision:rev},admin.cookie);assert.equal(pub.status,200,JSON.stringify(pub.data));
  // 教师开课堂 → 学生入课 → 建队 → 上传 → 练习提交
  const teacher=await login(base,'teacher@example.com','teacher');
  const k=(await call(base,'classes',{courseId:cid},teacher.cookie)).data;
  const student=await login(base,'student@example.com','student');
  assert.equal((await call(base,'join',{code:k.joinCode},student.cookie)).status,200);
  const tid=(await call(base,'teams',{classId:k.id,name:'端到端组'},student.cookie)).data.id;
  const f=new FormData();f.set('classId',k.id);f.set('teamId',tid);f.set('file',new File(['print(1)'],'main.py'));
  const up=await call(base,'upload',f,student.cookie);assert.equal(up.status,200,JSON.stringify(up.data));
  const sub=await call(base,'submit',{experimentId:'exp-1',mode:'practice',fileIds:[up.data.id],note:'练习'},student.cookie);assert.equal(sub.status,200,JSON.stringify(sub.data));
  const done=await until(async()=>{const s=(await call(base,'state',undefined,student.cookie)).data;const x=s.submissions?.find(y=>y.id===sub.data.id);if(x?.status==='failed')throw Error('grade 任务失败：'+x.error);return x?.status==='complete'&&x.report?x:null;});
  assert.equal(done.report.total,100,'满分 fixture 应得总分 100');
  // 邮件：SMTP 未配置 → mail 离线、mailError 有提示、邮件任务留在队列不投递
  const st=(await call(base,'state',undefined,student.cookie)).data;
  assert.equal(st.health.mail,false);assert.ok(st.health.mailError,'应有 mailError 提示');
  assert.equal(st.health.acp,true);assert.equal(st.health.acpError,null);
  // 使用助手「小课」：经 runPiPrint + smart fixture（无任务类型的 prompt 固定回 'ok'），历史入库
  const as=await call(base,'assist',{message:'怎么加入课堂？'},admin.cookie);assert.equal(as.status,200,JSON.stringify(as.data));assert.equal(as.data.reply,'ok');
  const hist=(await call(base,'state',undefined,admin.cookie)).data.assistHistory;
  assert.equal(hist.length,2);assert.deepEqual(hist.map(h=>h.role),['user','assistant']);assert.equal(hist[1].content,'ok');
  const mails=app.sqlite.prepare("SELECT status FROM jobs WHERE kind='email'").all();
  assert.ok(mails.length>0,'登录验证码应产生邮件任务');
  assert.ok(mails.every(m=>m.status==='queued'),'SMTP 未配置时邮件任务不得投递');
  // print 模式断言：任务调用带 @PROMPT.md 且文件存在；探测带 --no-tools，任务调用带工具
  const calls=await readPiLog(logFile);
  assert.ok(calls.length>=3,'探测 + draft + grade 至少三次调用');
  assert.ok(calls.every(c=>c.promptFile==='@PROMPT.md'&&c.promptExists),'每次调用都应收到存在的 @PROMPT.md');
  assert.ok(calls.some(c=>c.noTools),'探测调用应带 --no-tools');
  assert.ok(calls.some(c=>!c.noTools),'任务调用应保留工具');
 }finally{delete process.env.FAKE_PI_LOG;await app.close();await fs.rm(bin,{recursive:true,force:true,maxRetries:10,retryDelay:200});await fs.rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
},{timeout:120000});
test('PATH 无 pi：health.acp 为 false 且 acpFound 为 false（界面据此显示未连接）',async()=>{
 const emptyBin=await fs.mkdtemp(path.join(os.tmpdir(),'pi-none-'));
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'course-loop-nopi-'));
 const app=await startServer({port:0,host:'127.0.0.1',dataDir,env:testEnv,pathEnv:emptyBin,pollIntervalMs:200,scanIntervalMs:0,probeTimeoutMs:15000,clientDir:path.join(dataDir,'no-client'),serverEntry:null,log:()=>{}});
 try{
  const base=`http://127.0.0.1:${app.port}`;
  const admin=await login(base,'admin@example.com');
  const s=(await call(base,'state',undefined,admin.cookie)).data;
  assert.equal(s.health.acp,false);assert.equal(s.health.online,false);
  assert.equal(s.health.acpFound,false);assert.equal(s.health.acpError,null);
  assert.match(app.piState.error,/未在本机 PATH 找到 pi/);
  assert.ok(app.piState.spec===null);
  // pi 不可用：assist 诚实降级 503，不编造回答
  const noPi=await call(base,'assist',{message:'怎么用？'},admin.cookie);assert.equal(noPi.status,503);assert.match(noPi.data.error,/小课暂时不可用/);
 }finally{await app.close();await fs.rm(emptyBin,{recursive:true,force:true,maxRetries:10,retryDelay:200});await fs.rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
},{timeout:60000});
