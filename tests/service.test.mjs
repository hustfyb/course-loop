import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
let api;
before(async()=>{const dir=path.resolve('test-output/modules');await fs.mkdir(dir,{recursive:true});for(const name of ['domain','seed','service']){let src=await fs.readFile(`lib/${name}.ts`,'utf8');src=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("'./seed'","'./seed.mjs'").replaceAll("'./domain'","'./domain.mjs'");await fs.writeFile(path.join(dir,name+'.mjs'),src);}({api}=await import('../test-output/modules/service.mjs'));});
function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');const blobs=new Map();const wrapper=(sql,params=[])=>({bind(...v){return wrapper(sql,v)},async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:r.changes}}}});const env={DB:{prepare:wrapper,async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e}}},FILES:{async put(k,b){blobs.set(k,b)},async get(k){return blobs.has(k)?{body:blobs.get(k)}:null},async delete(k){blobs.delete(k)}},LOCAL_DEV:'1',DEV_EMAIL_CODE:'123456',ADMIN_EMAILS:'admin@example.com'};return {sqlite,env,blobs};}
async function init(){const x=setup();for(const f of (await fs.readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())x.sqlite.exec(await fs.readFile('drizzle/'+f,'utf8'));return x;}
async function req(x,url,data,cookie='',headers={}){const r=await api(new Request('http://localhost/api/'+url,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)}),x.env);const type=r.headers.get('content-type');return {status:r.status,data:type?.includes('json')?await r.json():await r.arrayBuffer(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(x,em,role='student'){assert.equal((await req(x,'auth/request',{email:em})).status,200);const r=await req(x,'auth/verify',{email:em,code:'123456'});assert.equal(r.status,200,JSON.stringify(r.data));let user=r.data.user;if(user.role==='pending'){const body={role,name:em.split('@')[0]};if(role==='student')body.studentNo='2026001';const p=await req(x,'auth/profile',body,r.cookie);assert.equal(p.status,200,JSON.stringify(p.data));user=p.data.user;}return {cookie:r.cookie,user};}
async function classroom(x){const a=await login(x,'admin@example.com');const cid=(await req(x,'courses',{},a.cookie)).data.id;const t=await login(x,'teacher@example.com','teacher');const k=(await req(x,'classes',{courseId:cid},t.cookie)).data;return {a,t,cid,kid:k.id,code:k.joinCode};}
test('email auth: OTP attempts, reuse, pending registration, cross-origin and session',async()=>{const x=await init();await req(x,'auth/request',{email:'student@example.com'});assert.equal((await req(x,'auth/verify',{email:'student@example.com',code:'bad'})).status,400);
 // 新邮箱注册为 pending，多余的 role/name/studentNo 字段被忽略
 const s=await req(x,'auth/verify',{email:'student@example.com',code:'123456',role:'teacher',name:'学生',studentNo:'1'});assert.equal(s.data.user.role,'pending');assert.equal(s.data.user.name,'');assert.equal(s.data.user.studentNo,'');
 assert.equal((await req(x,'auth/verify',{email:'student@example.com',code:'123456'})).status,400); // 验证码一次性
 // pending 用户被业务端点 403 拦截，state 与 auth/* 豁免
 assert.equal((await req(x,'courses',{},s.cookie)).status,403);assert.equal((await req(x,'courses',{},s.cookie)).data.error,'请先完善个人信息');assert.equal((await req(x,'join',{code:'x'},s.cookie)).status,403);assert.equal((await req(x,'teams',{classId:'x',name:'x'},s.cookie)).status,403);assert.equal((await req(x,'state',undefined,s.cookie)).data.user.role,'pending');
 // pending 用户可正常注销
 await req(x,'auth/request',{email:'out@example.com'});const o=await req(x,'auth/verify',{email:'out@example.com',code:'123456'});assert.equal((await req(x,'auth/logout',{},o.cookie)).status,200);
 // 补全身份：学生缺学号 400，身份类型无效 400，缺姓名 400
 assert.equal((await req(x,'auth/profile',{role:'student',name:'学生'},s.cookie)).status,400);assert.equal((await req(x,'auth/profile',{role:'admin',name:'学生',studentNo:'1'},s.cookie)).status,400);assert.equal((await req(x,'auth/profile',{role:'student',studentNo:'1'},s.cookie)).status,400);
 const sp=await req(x,'auth/profile',{role:'student',name:'学生',studentNo:'1'},s.cookie);assert.equal(sp.status,200);assert.equal(sp.data.user.role,'student');assert.equal(sp.data.user.name,'学生');
 const dup=await req(x,'auth/profile',{role:'student',name:'再提交',studentNo:'2'},s.cookie);assert.equal(dup.status,409);assert.equal(dup.data.error,'身份信息已完善');
 // 补全后按角色正常使用
 assert.equal((await req(x,'courses',{},s.cookie)).status,403);assert.equal((await req(x,'join',{code:'x'},s.cookie,{origin:'https://evil.example'})).status,403);assert.equal((await req(x,'state',undefined,s.cookie)).data.user.email,'student@example.com');
 // 教师经两段式注册
 const t2=await login(x,'teach2@example.com','teacher');assert.equal(t2.user.role,'teacher');assert.equal(t2.user.studentNo,'');
 // admin 邮箱 verify 直通，无需补全
 await req(x,'auth/request',{email:'admin@example.com'});const ad=await req(x,'auth/verify',{email:'admin@example.com',code:'123456',name:'管理员',role:'teacher',studentNo:'9'});assert.equal(ad.data.user.role,'admin');assert.equal(ad.data.user.name,'课程管理员');assert.equal(ad.data.user.studentNo,'');assert.equal((await req(x,'courses',{},ad.cookie)).status,200);assert.equal((await req(x,'auth/profile',{role:'student',name:'x',studentNo:'1'},ad.cookie)).status,409);
 // 老用户二次登录 role 与 name 不变，冒充字段无效
 x.sqlite.prepare('DELETE FROM otps WHERE email=?').run('teach2@example.com');await req(x,'auth/request',{email:'teach2@example.com'});const t2b=await req(x,'auth/verify',{email:'teach2@example.com',code:'123456',name:'冒充',role:'student',studentNo:'1'});assert.equal(t2b.data.user.role,'teacher');assert.equal(t2b.data.user.name,'teach2');});
test('teacher opens class with join code; student joins by class code only',async()=>{const x=await init();const {a,t,cid,kid,code}=await classroom(x);assert.match(code,/^[A-Z0-9]{10}$/);const s=await login(x,'s@example.com');
 const bad=await req(x,'join',{code:'WRONGCODE1'},s.cookie);assert.equal(bad.status,400);assert.equal(bad.data.error,'课堂邀请码无效');
 const j=await req(x,'join',{code:code.toLowerCase()},s.cookie);assert.equal(j.status,200);assert.equal(j.data.id,kid);assert.equal((await req(x,'join',{code},s.cookie)).status,200);
 assert.equal((await req(x,'join',{code},t.cookie)).status,403);assert.equal((await req(x,'classes',{courseId:cid},s.cookie)).status,403);assert.equal((await req(x,'classes',{courseId:cid},a.cookie)).status,403);assert.equal((await req(x,'courses',{},t.cookie)).status,403);
 const ts=(await req(x,'state',undefined,t.cookie)).data;assert.equal(ts.courses.length,1);assert.equal(ts.courses[0].joinCode,undefined);assert.equal(ts.classes.length,1);assert.equal(ts.classes[0].joinCode,code);assert.equal(ts.selected,kid);assert.equal(ts.students.length,1);assert.equal(ts.draft,null);assert.equal(ts.release,null);
 const ss=(await req(x,'state',undefined,s.cookie)).data;assert.equal(ss.courses.length,0);assert.equal(ss.classes.length,1);assert.equal(ss.classes[0].joinCode,undefined);assert.ok(ss.classes[0].teacherName);
 const as=(await req(x,'state',undefined,a.cookie)).data;assert.equal(as.classes.length,0);assert.equal(as.courses[0].joinCode,undefined);assert.equal(as.courseClasses.length,1);assert.equal(as.courseClasses[0].students,1);assert.equal(as.courseClasses[0].teams,0);assert.equal(as.courseClasses[0].teacherName,'teacher');});
test('student without class: empty state shape and pending invite banner',async()=>{const x=await init();const {kid,code}=await classroom(x);const s1=await login(x,'s1@example.com');await req(x,'join',{code},s1.cookie);const tid=(await req(x,'teams',{classId:kid,name:'组'},s1.cookie)).data.id;
 const n=await login(x,'new@example.com');const before=(await req(x,'state',undefined,n.cookie)).data;assert.equal(before.courses.length,0);assert.equal(before.classes.length,0);assert.equal(before.selected,undefined);assert.equal(before.draft,undefined);assert.equal(before.pendingInvites.length,0);
 await req(x,'invite',{teamId:tid,email:'new@example.com'},s1.cookie);const after=(await req(x,'state',undefined,n.cookie)).data;assert.equal(after.classes.length,0);assert.equal(after.pendingInvites.length,1);assert.equal(after.pendingInvites[0].teamName,'组');});
test('team invitation, single team, capacity, recipient authorization and formal snapshot',async()=>{const x=await init();const {a,t,cid,kid,code}=await classroom(x);const sA=await login(x,'a@example.com'),sB=await login(x,'b@example.com'),eve=await login(x,'eve@example.com');for(const p of [sA,sB,eve])assert.equal((await req(x,'join',{code},p.cookie)).status,200);
 const tr=await req(x,'teams',{classId:kid,name:'测试组'},sA.cookie);assert.equal(tr.status,200);const tid=tr.data.id;assert.equal((await req(x,'teams',{classId:kid,name:'重复组'},sA.cookie)).status,409);
 await req(x,'invite',{teamId:tid,email:sB.user.email},sA.cookie);const iv=x.sqlite.prepare('SELECT * FROM invites').get();assert.equal((await req(x,'invite-action',{id:iv.id,action:'accept'},eve.cookie)).status,403);assert.equal((await req(x,'invite-action',{id:iv.id,action:'accept'},sB.cookie)).status,200);assert.equal((await req(x,'invite-action',{id:iv.id,action:'accept'},sB.cookie)).status,409);
 const mail=x.sqlite.prepare("SELECT payload FROM jobs WHERE kind='email' ORDER BY created DESC LIMIT 1").get();assert.ok(mail.payload.includes(code),'邀请邮件应包含课堂邀请码');
 assert.equal((await req(x,'publish',{courseId:cid,revision:1},t.cookie)).status,403);assert.equal((await req(x,'publish',{courseId:cid,revision:1},a.cookie)).status,200);
 const f=new FormData();f.set('classId',kid);f.set('teamId',tid);f.set('file',new File(['print(1)'],'main.py'));const up=await req(x,'upload',f,sA.cookie);assert.equal(up.status,200,JSON.stringify(up.data));assert.equal((await req(x,'files/'+up.data.id,undefined,eve.cookie)).status,403);
 const args={teamId:tid,experimentId:'exp-1',mode:'formal',fileIds:[up.data.id],note:'测试'};assert.equal((await req(x,'submit',args,sB.cookie)).status,403);const sub=await req(x,'submit',args,sA.cookie);assert.equal(sub.status,200,JSON.stringify(sub.data));
 // 成员管理完全是学生责任：非组长邀请 403，教师邀请/移除 403
 assert.equal((await req(x,'invite',{teamId:tid,email:'extra@example.com'},sB.cookie)).status,403);assert.equal((await req(x,'invite',{teamId:tid,email:'extra@example.com'},t.cookie)).status,403);assert.equal((await req(x,'team-action',{teamId:tid,action:'remove',userId:sB.user.id},t.cookie)).status,403);
 // 正式提交不再锁定成员：组员可自行退出，快照保留
 assert.equal((await req(x,'team-action',{teamId:tid,action:'leave'},sB.cookie)).status,200);
 const saved=x.sqlite.prepare('SELECT * FROM submissions').get();assert.equal(saved.classId,kid);assert.equal(JSON.parse(saved.members).length,2);
 assert.equal((await req(x,'submit',args,sA.cookie)).status,200);assert.equal((await req(x,'submit',args,sA.cookie)).status,400);});
test('team repo: member sets GitHub URL, validation, non-member 403, clearing',async()=>{const x=await init();const {kid,code}=await classroom(x);const s1=await login(x,'r1@example.com');const s2=await login(x,'r2@example.com');for(const p of [s1,s2])assert.equal((await req(x,'join',{code},p.cookie)).status,200);
 const tid=(await req(x,'teams',{classId:kid,name:'仓库组'},s1.cookie)).data.id;
 // 组员设置成功，末尾斜杠被规范化；state 中带 repo
 const ok=await req(x,'team-repo',{teamId:tid,repo:'https://github.com/owner/repo/'},s1.cookie);assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(x.sqlite.prepare('SELECT repo FROM teams WHERE id=?').get(tid).repo,'https://github.com/owner/repo');
 assert.equal((await req(x,'state',undefined,s1.cookie)).data.teams[0].repo,'https://github.com/owner/repo');
 // 非法 URL 400
 assert.equal((await req(x,'team-repo',{teamId:tid,repo:'not-a-url'},s1.cookie)).status,400);assert.equal((await req(x,'team-repo',{teamId:tid,repo:'https://gitlab.com/owner/repo'},s1.cookie)).status,400);const bad=await req(x,'team-repo',{teamId:tid,repo:'https://github.com/owner'},s1.cookie);assert.equal(bad.status,400);assert.match(bad.data.error,/GitHub 仓库地址/);
 // 非组员（含同课堂其他学生）403
 assert.equal((await req(x,'team-repo',{teamId:tid,repo:'https://github.com/o/r'},s2.cookie)).status,403);
 // 清除成功
 assert.equal((await req(x,'team-repo',{teamId:tid,repo:''},s1.cookie)).status,200);assert.equal(x.sqlite.prepare('SELECT repo FROM teams WHERE id=?').get(tid).repo,'');});
test('ACP job lease, invalid scoring rejection, stable version, completion and appeal review',async()=>{const x=await init();const {a,t,cid,kid,code}=await classroom(x);const p=(await req(x,'pair',{},a.cookie)).data;const headers={authorization:'Bearer '+p.token};assert.equal((await req(x,'pair',{},t.cookie)).status,403);
 assert.equal((await req(x,'chat',{courseId:cid,message:'请整理',fileIds:[]},t.cookie)).status,403);await req(x,'chat',{courseId:cid,message:'请整理',fileIds:[]},a.cookie);let j=(await req(x,'connector/poll',{acp:true},'',headers)).data.job;assert.equal(j.kind,'draft');assert.equal((await req(x,'connector/finish/'+j.id,{result:{}},'',{...headers,'x-job-lease':'bad'})).status,409);const d=j.payload.draft;d.title='课程修订';assert.equal((await req(x,'connector/finish/'+j.id,{result:{draft:d,message:'已更新'}},'',{...headers,'x-job-lease':j.lease})).status,200);assert.equal((await req(x,'publish',{courseId:cid,revision:1},a.cookie)).status,409);assert.equal((await req(x,'publish',{courseId:cid,revision:2},a.cookie)).status,200);assert.equal((await req(x,'connector/finish/'+j.id,{result:{draft:d}},'',{...headers,'x-job-lease':j.lease})).status,409);
 const tsnap=(await req(x,'state',undefined,t.cookie)).data;assert.equal(tsnap.draft.title,'课程修订');assert.equal(tsnap.release.revision,2);assert.equal(tsnap.course.id,cid);assert.equal(tsnap.draft.experiments.length,4);
 const s1=await login(x,'student@example.com');await req(x,'join',{code},s1.cookie);const tid=(await req(x,'teams',{classId:kid,name:'组'},s1.cookie)).data.id;const f=new FormData();f.set('classId',kid);f.set('teamId',tid);f.set('file',new File(['evidence'],'spec.md'));const fid=(await req(x,'upload',f,s1.cookie)).data.id;const sub=(await req(x,'submit',{teamId:tid,experimentId:'exp-1',mode:'formal',fileIds:[fid]},s1.cookie)).data;
 j=(await req(x,'connector/poll',{acp:true},'',headers)).data.job;assert.equal(j.kind,'grade');const lease={...headers,'x-job-lease':j.lease};const report={items:j.payload.experiment.rubric.map(r=>({id:r.id,score:r.max,reason:'对应条款验证',evidence:['spec.md:1']})),questions:['解释测试依据']};const invalid=structuredClone(report);invalid.items[0].score=100;assert.equal((await req(x,'connector/finish/'+j.id,{result:invalid},'',lease)).status,400);assert.equal((await req(x,'connector/finish/'+j.id,{result:report},'',lease)).status,200);assert.ok(x.sqlite.prepare('SELECT finished FROM jobs WHERE id=?').get(j.id).finished>0,'完成任务应记录完成时间');
 assert.equal((await req(x,'state',undefined,s1.cookie)).data.submissions[0].report,null);assert.ok((await req(x,'state',undefined,t.cookie)).data.submissions[0].report);
 assert.equal((await req(x,'grade-action',{submissionId:sub.id,reason:'校准样例已核对'},t.cookie)).status,200);assert.equal((await req(x,'state',undefined,s1.cookie)).data.submissions[0].report.total,100);
 assert.equal((await req(x,'appeal',{submissionId:sub.id,content:'请求复核'},s1.cookie)).status,200);assert.equal((await req(x,'answer',{submissionId:sub.id,content:'这条测试检查列表未被修改'},s1.cookie)).status,200);assert.equal((await req(x,'answer',{submissionId:sub.id,content:'重复'},s1.cookie)).status,409);});
test('non-owner teacher cannot see or operate another teacher\'s class',async()=>{const x=await init();const {a,cid,kid,code}=await classroom(x);const t2=await login(x,'other@example.com','teacher');
 const s0=(await req(x,'state',undefined,t2.cookie)).data;assert.equal(s0.classes.length,0);assert.equal(s0.courses.length,1);assert.equal(s0.selected,undefined);
 assert.equal((await req(x,'class-settings',{classId:kid,maxSize:4,autoPublish:false},t2.cookie)).status,403);assert.equal((await req(x,'teams',{classId:kid,name:'抢注'},t2.cookie)).status,400);
 const k2=(await req(x,'classes',{courseId:cid,name:'二课堂'},t2.cookie)).data;assert.match(k2.joinCode,/^[A-Z0-9]{10}$/);assert.notEqual(k2.joinCode,code);
 assert.equal((await req(x,'state?class='+k2.id,undefined,t2.cookie)).data.selected,k2.id);assert.equal((await req(x,'state?class='+kid,undefined,t2.cookie)).data.selected,undefined);
 const s1=await login(x,'st@example.com');await req(x,'join',{code},s1.cookie);await req(x,'publish',{courseId:cid,revision:1},a.cookie);const tid=(await req(x,'teams',{classId:kid,name:'组'},s1.cookie)).data.id;const f=new FormData();f.set('classId',kid);f.set('teamId',tid);f.set('file',new File(['e'],'spec.md'));const fid=(await req(x,'upload',f,s1.cookie)).data.id;const sub=(await req(x,'submit',{teamId:tid,experimentId:'exp-1',mode:'formal',fileIds:[fid]},s1.cookie)).data;
 assert.equal((await req(x,'grade-action',{submissionId:sub.id,reason:'越权'},t2.cookie)).status,403);assert.equal((await req(x,'files/'+fid,undefined,t2.cookie)).status,403);});
test('unconfigured production email fails honestly; course material visibility is admin-only',async()=>{const x=await init();x.env.LOCAL_DEV='0';const r=await req(x,'auth/request',{email:'new@example.com'});assert.equal(r.status,503);x.env.LOCAL_DEV='1';
 const {a,t,cid,code}=await classroom(x);const f=new FormData();f.set('courseId',cid);f.set('file',new File(['rubric'],'标准.md'));const up=await req(x,'upload',f,a.cookie);assert.equal(up.status,200);
 const f2=new FormData();f2.set('courseId',cid);f2.set('file',new File(['x'],'x.md'));assert.equal((await req(x,'upload',f2,t.cookie)).status,403);
 const f3=new FormData();f3.set('courseId',cid);f3.set('teamId','whatever');f3.set('file',new File(['x'],'x.md'));assert.equal((await req(x,'upload',f3,a.cookie)).status,400);
 const s=await login(x,'s@example.com');await req(x,'join',{code},s.cookie);assert.equal((await req(x,'files/'+up.data.id,undefined,s.cookie)).status,403);
 assert.equal((await req(x,'file-visibility',{id:up.data.id,shared:true},t.cookie)).status,403);assert.equal((await req(x,'file-visibility',{id:up.data.id,shared:true},a.cookie)).status,200);assert.equal((await req(x,'files/'+up.data.id,undefined,s.cookie)).status,200);});
test('capacity, unregistered invitation visibility, cancellation and unresolved draft guard',async()=>{const x=await init();const {a,t,cid,kid,code}=await classroom(x);const s1=await login(x,'a2@example.com');await req(x,'join',{code},s1.cookie);const tid=(await req(x,'teams',{classId:kid,name:'邀请测试'},s1.cookie)).data.id;
 assert.equal((await req(x,'class-settings',{classId:kid,maxSize:1,autoPublish:false},t.cookie)).status,200);await req(x,'invite',{teamId:tid,email:'new@example.com'},s1.cookie);
 const n=await login(x,'new@example.com');const state=(await req(x,'state',undefined,n.cookie)).data;assert.equal(state.classes.length,0);assert.equal(state.pendingInvites.length,1);const iv=state.pendingInvites[0];
 assert.equal((await req(x,'invite-action',{id:iv.id,action:'accept'},n.cookie)).status,409);await req(x,'class-settings',{classId:kid,maxSize:2,autoPublish:false},t.cookie);assert.equal((await req(x,'invite-action',{id:iv.id,action:'accept'},n.cookie)).status,200);assert.equal((await req(x,'state',undefined,n.cookie)).data.classes.length,1);
 const j=(await req(x,'chat',{courseId:cid,message:'改任务'},a.cookie)).data.jobId;assert.equal((await req(x,'publish',{courseId:cid,revision:1},a.cookie)).status,409);
 assert.equal((await req(x,'job-action',{id:j,action:'cancel'},t.cookie)).status,403);await req(x,'job-action',{id:j,action:'cancel'},a.cookie);
 const d=JSON.parse(x.sqlite.prepare('SELECT draft FROM courses').get().draft);d.questions=['MCP 是否必做？'];x.sqlite.prepare('UPDATE courses SET draft=?').run(JSON.stringify(d));assert.equal((await req(x,'publish',{courseId:cid,revision:1},a.cookie)).status,400);});
test('migration 0001 preserves legacy course data in a default class',async()=>{const files=(await fs.readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort();assert.deepEqual(files.length,5);const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(await fs.readFile('drizzle/'+files[0],'utf8'));
 const t=Date.now();sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('u1','t@x.com','教师','','teacher',t);sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('u2','s@x.com','学生','001','student',t);
 sqlite.prepare("INSERT INTO courses(id,owner,title,term,draft,joinCode,maxSize,deadline,maxFormal,autoPublish,created) VALUES('c1','u1','课','学期','{}','CODE123456',5,NULL,3,1,?)").run(t);
 sqlite.prepare("INSERT INTO enrollments VALUES('c1','u2')").run();sqlite.prepare("INSERT INTO teams VALUES('tm1','c1','u2','组',0,?)").run(t);sqlite.prepare("INSERT INTO members VALUES('c1','tm1','u2',1)").run();sqlite.prepare("INSERT INTO invites VALUES('iv1','tm1','n@x.com','pending',?)").run(t);
 sqlite.prepare("INSERT INTO files VALUES('f1','u2','c1','tm1','f1','a.py','text/x-python',3,'private',?)").run(t);sqlite.prepare("INSERT INTO files VALUES('f2','u1','c1',NULL,'f2','b.md','text/md',3,'student',?)").run(t);
 sqlite.prepare("INSERT INTO jobs(id,owner,courseId,teamId,kind,payload,created) VALUES('j1','u2','c1','tm1','grade','{}',?)").run(t);sqlite.prepare("INSERT INTO submissions VALUES('s1','c1','tm1','e1','r1','formal',1,'[]','[]','','j1',?)").run(t);
 sqlite.exec(await fs.readFile('drizzle/'+files[1],'utf8'));
 const cl=sqlite.prepare('SELECT * FROM classes').get();assert.equal(cl.courseId,'c1');assert.equal(cl.owner,'u1');assert.equal(cl.name,'默认课堂');assert.equal(cl.joinCode,'CODE123456');assert.equal(cl.maxSize,5);assert.equal(cl.maxFormal,3);assert.equal(cl.autoPublish,1);
 assert.equal(sqlite.prepare('SELECT classId FROM enrollments').get().classId,cl.id);assert.equal(sqlite.prepare('SELECT classId FROM teams').get().classId,cl.id);assert.equal(sqlite.prepare('SELECT classId FROM members').get().classId,cl.id);assert.equal(sqlite.prepare('SELECT classId FROM submissions').get().classId,cl.id);
 assert.equal(sqlite.prepare("SELECT classId FROM files WHERE id='f1'").get().classId,cl.id);assert.equal(sqlite.prepare("SELECT classId FROM files WHERE id='f2'").get().classId,null);assert.equal(sqlite.prepare("SELECT classId FROM jobs WHERE id='j1'").get().classId,cl.id);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n,1);assert.equal(sqlite.prepare("SELECT role FROM users WHERE id='u1'").get().role,'admin');
 const cols=sqlite.prepare('PRAGMA table_info(courses)').all().map(c=>c.name);assert.ok(!cols.includes('joinCode')&&!cols.includes('maxSize'));
 assert.throws(()=>sqlite.prepare("INSERT INTO enrollments VALUES('nope','u2')").run(),/FOREIGN KEY/);
 // 0002 在 0000+0001 初始化且含数据的库上执行成功，teams 增加 repo 且默认 ''
 sqlite.exec(await fs.readFile('drizzle/'+files[2],'utf8'));assert.equal(sqlite.prepare("SELECT repo FROM teams WHERE id='tm1'").get().repo,'');});
test('mail quota failure surfaces try-tomorrow hint; other failures do not block',async()=>{const x=await init();x.env.LOCAL_DEV='0';x.sqlite.prepare("INSERT INTO settings VALUES('connector_health',?)").run(JSON.stringify({mailAt:Date.now()}));x.sqlite.prepare("INSERT INTO jobs(id,owner,kind,payload,status,error,created) VALUES('jq','system','email','{}','failed',?,?)").run('Message failed: 429 rate_limit_exceeded: daily quota exceeded',Date.now());const r=await req(x,'auth/request',{email:'q@example.com'});assert.equal(r.status,429);assert.match(r.data.error,/额度已用完.*明天再试/);x.sqlite.prepare("UPDATE jobs SET error='Message failed: 550 Invalid to field' WHERE id='jq'").run();const ok=await req(x,'auth/request',{email:'q2@example.com'});assert.equal(ok.status,200);});
test('assist: 注入 runAssist 返回回复并记录双方消息；未注入 503 不写 assistant；未登录 401',async()=>{const x=await init();
 // 未登录 401
 assert.equal((await req(x,'assist',{message:'怎么用'})).status,401);
 const s=await login(x,'s@example.com');
 // 默认 env 无 runAssist：503 诚实降级；用户消息已写入，assistant 消息不写
 const no=await req(x,'assist',{message:'怎么加入课堂？'},s.cookie);assert.equal(no.status,503);assert.match(no.data.error,/小课暂时不可用.*提改进意见/);
 assert.equal(x.sqlite.prepare('SELECT COUNT(*) n FROM assist').get().n,1);
 assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM assist WHERE role='assistant'").get().n,0);
 // 注入假 runAssist：返回 reply，prompt 携带身份指南与历史
 let got='';x.env.runAssist=async(p)=>{got=p;return '测试回复';};
 const r=await req(x,'assist',{message:'正式提交谁操作？'},s.cookie);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.reply,'测试回复');
 assert.match(got,/你是「小课」/);assert.match(got,/怎么加入课堂？/);assert.match(got,/正式提交谁操作？/);
 const rows=x.sqlite.prepare('SELECT role,content FROM assist ORDER BY rowid').all();
 assert.deepEqual(rows.map(r=>r.role),['user','user','assistant']);assert.equal(rows[2].content,'测试回复');
 // state 快照含本人 assistHistory（升序）
 const st=(await req(x,'state',undefined,s.cookie)).data;assert.equal(st.assistHistory.length,3);assert.equal(st.assistHistory.at(-1).role,'assistant');assert.equal(st.assistHistory.at(-1).content,'测试回复');
 // 空消息 400；runAssist 返回空 → 503
 assert.equal((await req(x,'assist',{message:'  '},s.cookie)).status,400);
 x.env.runAssist=async()=>'';assert.equal((await req(x,'assist',{message:'再问'},s.cookie)).status,503);});
test('feedback: 学生提交、admin 查看与标记/重开、学生无权 feedback-action',async()=>{const x=await init();const a=await login(x,'admin@example.com');const s=await login(x,'stu@example.com');
 assert.equal((await req(x,'feedback',{content:'x'})).status,401); // 未登录
 const r=await req(x,'feedback',{content:'希望支持深色模式'},s.cookie);assert.equal(r.status,200);assert.deepEqual(r.data,{ok:true});
 assert.equal((await req(x,'feedback',{content:''},s.cookie)).status,400); // 空内容
 // admin state 含 feedbackList（用户信息 join），学生 state 不含
 const st=(await req(x,'state',undefined,a.cookie)).data;assert.equal(st.feedbackList.length,1);
 const fb=st.feedbackList[0];assert.equal(fb.content,'希望支持深色模式');assert.equal(fb.status,'open');assert.equal(fb.userEmail,'stu@example.com');assert.equal(fb.userName,'stu');assert.equal(fb.userRole,'student');
 assert.equal((await req(x,'state',undefined,s.cookie)).data.feedbackList,undefined);
 // 越权与参数校验
 assert.equal((await req(x,'feedback-action',{id:fb.id,action:'close'},s.cookie)).status,403);
 assert.equal((await req(x,'feedback-action',{id:fb.id,action:'hack'},a.cookie)).status,400);
 assert.equal((await req(x,'feedback-action',{id:'none',action:'close'},a.cookie)).status,404);
 // close → closed；open 重开；均写 audit
 assert.equal((await req(x,'feedback-action',{id:fb.id,action:'close'},a.cookie)).status,200);
 assert.equal(x.sqlite.prepare('SELECT status FROM feedback WHERE id=?').get(fb.id).status,'closed');
 assert.equal((await req(x,'feedback-action',{id:fb.id,action:'open'},a.cookie)).status,200);
 assert.equal(x.sqlite.prepare('SELECT status FROM feedback WHERE id=?').get(fb.id).status,'open');
 assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'feedback.%'").get().n,2);});
test('course deletion: empty course only, admin only, cascades course-level data',async()=>{const x=await init();const {a,t,cid}=await classroom(x);
 // 有课堂的课程拒绝删除；非管理员拒绝
 assert.equal((await req(x,'course-delete',{courseId:cid},t.cookie)).status,403);assert.equal((await req(x,'course-delete',{courseId:cid},a.cookie)).status,409);
 // 空课程可删：先建一门新课并上传课程素材
 const cid2=(await req(x,'courses',{term:'误建学期'},a.cookie)).data.id;const f=new FormData();f.set('courseId',cid2);f.set('file',new File(['m'],'大纲.md'));const up=await req(x,'upload',f,a.cookie);assert.equal(up.status,200);assert.equal(x.blobs.size,1);
 const del=await req(x,'course-delete',{courseId:cid2},a.cookie);assert.equal(del.status,200,JSON.stringify(del.data));assert.equal(x.blobs.size,0);assert.equal(x.sqlite.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get(cid2).n,0);assert.equal(x.sqlite.prepare('SELECT COUNT(*) n FROM files WHERE courseId=?').get(cid2).n,0);assert.equal(x.sqlite.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get(cid).n,1);});
test('file deletion: admin deletes course material; class files protected; others forbidden',async()=>{const x=await init();const {a,t,cid,kid}=await classroom(x);
 const f=new FormData();f.set('courseId',cid);f.set('file',new File(['m'],'素材.md'));const up=await req(x,'upload',f,a.cookie);assert.equal(up.status,200);
 // 教师/学生不能删课程素材
 assert.equal((await req(x,'file-delete',{id:up.data.id},t.cookie)).status,403);
 // 课堂文件（学生作业）保护：学生上传课堂文件后 admin 也不能删
 const s=await login(x,'sf@example.com');await req(x,'join',{code:(await req(x,'state',undefined,t.cookie)).data.classes[0].joinCode},s.cookie);const st=(await req(x,'state',undefined,s.cookie)).data;const tid=st.teams.length?st.myTeam:(await req(x,'teams',{classId:kid,name:'组'},s.cookie)).data.id;const ff=new FormData();ff.set('classId',kid);ff.set('teamId',tid);ff.set('file',new File(['x'],'作业.md'));const upf=await req(x,'upload',ff,s.cookie);assert.equal(upf.status,200,JSON.stringify(upf.data));assert.equal((await req(x,'file-delete',{id:upf.data.id},a.cookie)).status,400);
 // 管理员删除课程素材：记录与对象都消失，下载 404
 assert.equal((await req(x,'file-delete',{id:up.data.id},a.cookie)).status,200);assert.equal(x.blobs.size,1);assert.equal((await req(x,'files/'+up.data.id,undefined,a.cookie)).status,404);});
