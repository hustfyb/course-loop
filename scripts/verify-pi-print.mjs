// 真实 pi print 模式端到端验证（临时实例，端口 7200，独立数据目录 .verify-data，完成后删除）。
// 用法：node scripts/verify-pi-print.mjs setup | grade | clean
// setup：启动服务器 → 探测 pi → 建课/对话草案/发布 → 教师开课/学生入课/建队/上传/提交（可重复运行续跑）。
// grade：重启同一数据目录，等待评分完成并打印报告 total/items。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server/node-server.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const dataDir=path.join(root,'.verify-data');
const stateFile=path.join(dataDir,'verify-state.json');
const stage=process.argv[2];
const env={PATH:process.env.PATH,ADMIN_EMAILS:'admin@example.com',LOCAL_DEV:'1',DEV_EMAIL_CODE:'123456',PI_COMMAND:'C:\\nvm4w\\nodejs\\pi.cmd',PORT:'7200'};
async function call(base,url,data,cookie){const r=await fetch(base+'/api/'+url,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined||data instanceof FormData?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)});const type=r.headers.get('content-type');const setCookie=r.headers.getSetCookie?.()[0];return {status:r.status,data:type?.includes('json')?await r.json():await r.arrayBuffer(),cookie:setCookie?setCookie.split(';')[0]:undefined};}
async function login(base,em,role){const r0=await call(base,'auth/request',{email:em});if(r0.status!==200)throw Error('auth/request 失败 '+JSON.stringify(r0.data));const r=await call(base,'auth/verify',{email:em,code:'123456'});if(r.status!==200)throw Error('auth/verify 失败 '+JSON.stringify(r.data));let user=r.data.user;if(user.role==='pending'&&role){const body={role,name:em.split('@')[0]};if(role==='student')body.studentNo='2026001';const p=await call(base,'auth/profile',body,r.cookie);if(p.status!==200)throw Error('profile 失败 '+JSON.stringify(p.data));user=p.data.user;}return {cookie:r.cookie,user};}
async function until(fn,timeoutMs,step=1000,label=''){const end=Date.now()+timeoutMs;let last;while(Date.now()<end){last=await fn();if(last)return last;await new Promise(r=>setTimeout(r,step));}throw Error('等待超时 '+label+'：'+JSON.stringify(last).slice(0,300));}
async function loadState(){try{return JSON.parse(await fs.readFile(stateFile,'utf8'));}catch{return {}};}
async function saveState(s){await fs.writeFile(stateFile,JSON.stringify(s,null,2));}
async function boot(){console.log('[verify] 启动临时服务器（7200，数据目录 .verify-data）…');const app=await startServer({port:7200,host:'127.0.0.1',dataDir,env,pollIntervalMs:1000,scanIntervalMs:0,log:console.log});if(!app.piState.spec)throw Error('未扫描/探测到 pi：'+app.piState.error);console.log('[verify] pi 探测通过：'+app.piState.spec.command);return app;}
if(stage==='clean'){await fs.rm(dataDir,{recursive:true,force:true});console.log('[verify] 已清理 .verify-data');process.exit(0);}
if(stage==='setup'){
 const app=await boot();
 try{
  const base=`http://127.0.0.1:${app.port}`;
  const st=await loadState();
  const admin=await login(base,'admin@example.com');
  if(!st.courseId){st.courseId=(await call(base,'courses',{},admin.cookie)).data.id;console.log('[verify] 建课',st.courseId);}
  let s=(await call(base,'state',undefined,admin.cookie)).data;
  const course=s.courses.find(c=>c.id===st.courseId);
  if(!st.draftDone){
   const job=s.jobs?.find(j=>j.kind==='draft');
   if(!job){const r=await call(base,'chat',{courseId:st.courseId,message:'请整理课程',fileIds:[]},admin.cookie);if(r.status!==200)throw Error('chat 失败 '+JSON.stringify(r.data));console.log('[verify] 已发起 draft 任务');}
   await until(async()=>{s=(await call(base,'state',undefined,admin.cookie)).data;const j=s.jobs?.filter(x=>x.kind==='draft').at(-1);if(j?.status==='failed')throw Error('draft 任务失败：'+j.error);return j?.status==='complete'?j:null;},170000,2000,'draft');
   st.draftDone=true;await saveState(st);console.log('[verify] draft 完成');
  }
  s=(await call(base,'state',undefined,admin.cookie)).data;
  const rev=s.courses.find(c=>c.id===st.courseId).revision;
  if(!st.published){const pub=await call(base,'publish',{courseId:st.courseId,revision:rev},admin.cookie);if(pub.status!==200)throw Error('发布失败 '+JSON.stringify(pub.data));st.published=true;await saveState(st);console.log('[verify] 已发布 revision',rev);}
  const teacher=await login(base,'teacher@example.com','teacher');
  if(!st.classId){st.classId=(await call(base,'classes',{courseId:st.courseId},teacher.cookie)).data.id;await saveState(st);console.log('[verify] 开课',st.classId);}
  const student=await login(base,'student@example.com','student');
  if(!st.joined){const ts=(await call(base,'state',undefined,teacher.cookie)).data;const code=ts.classes.find(c=>c.id===st.classId).joinCode;const j=await call(base,'join',{code},student.cookie);if(j.status!==200)throw Error('入课失败 '+JSON.stringify(j.data));st.joined=true;await saveState(st);console.log('[verify] 学生已入课');}
  if(!st.teamId){st.teamId=(await call(base,'teams',{classId:st.classId,name:'验证组'},student.cookie)).data.id;await saveState(st);console.log('[verify] 建队',st.teamId);}
  if(!st.fileId){const f=new FormData();f.set('classId',st.classId);f.set('teamId',st.teamId);f.set('file',new File(['print(1)'],'main.py'));const up=await call(base,'upload',f,student.cookie);if(up.status!==200)throw Error('上传失败 '+JSON.stringify(up.data));st.fileId=up.data.id;await saveState(st);console.log('[verify] 上传',st.fileId);}
  if(!st.submissionId){const sub=await call(base,'submit',{teamId:st.teamId,experimentId:'exp-1',mode:'practice',fileIds:[st.fileId],note:'真实验证'},student.cookie);if(sub.status!==200)throw Error('提交失败 '+JSON.stringify(sub.data));st.submissionId=sub.data.id;await saveState(st);console.log('[verify] 已提交 grade 任务',st.submissionId);}
  console.log('[verify] setup 完成');
 }finally{await app.close();console.log('[verify] 临时服务器已停止');}
 process.exit(0);
}
if(stage==='grade'){
 const app=await boot();
 try{
  const base=`http://127.0.0.1:${app.port}`;
  const st=await loadState();
  const student=await login(base,'student@example.com');
  const done=await until(async()=>{const s=(await call(base,'state',undefined,student.cookie)).data;const x=s.submissions?.find(y=>y.id===st.submissionId);if(x?.status==='failed')throw Error('grade 任务失败：'+x.error);return x?.status==='complete'&&x.report?x:null;},220000,3000,'grade');
  console.log('[verify] grade 完成，报告 total =',done.report.total);
  console.log('[verify] items =',JSON.stringify(done.report.items,null,2).slice(0,2000));
 }finally{await app.close();console.log('[verify] 临时服务器已停止');}
 process.exit(0);
}
console.error('未知阶段：'+stage);process.exit(1);
