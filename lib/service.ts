import type {Platform} from './platform';
import {validateDraft,validateAssessment} from './domain';
import {buildXlsx} from './xlsx';
const now=()=>Date.now(); const id=()=>crypto.randomUUID(); const json=(x:any)=>JSON.stringify(x);const parse=(x:any,f:any=null)=>{try{return JSON.parse(x)}catch{return f}};
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
const email=(x:any)=>String(x||'').trim().toLowerCase();
function need(v:any,m='没有访问权限',status=403):asserts v{if(!v)throw Object.assign(Error(m),{status});}
function text(v:any,max=20000){need(typeof v==='string'&&v.trim().length>0&&v.length<=max,'文本为空或过长',400);return v.trim();}
function reply(x:any,status=200,headers:any={}){return new Response(json(x),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
// GitHub 项目巡检：手工触发一次，评估仓库的**全部**提交历史（不再按时间窗口切片）。
// 配了 settings.github_token 走 REST API（5000 次/小时）；否则匿名 API（60 次/小时）/ commits.atom 兜底。
const NL=String.fromCharCode(10);
const COMMIT_PAGE_MAX=10; // 最多 10 页 × 100 条 = 1000 条，超出在摘要里标注截断
// 学生常直接粘贴 clone 地址（结尾带 .git），GitHub API 不接受，这里统一去掉
function parseRepo(url:string){
 let u:URL;try{u=new URL(String(url||'').trim());}catch{return null;}
 if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='github.com')return null;
 const seg=u.pathname.split('/').filter(Boolean);if(seg.length<2)return null;
 const owner=seg[0];const name=seg[1].replace(/[.]git$/i,'');
 return owner&&name?{owner,name}:null;
}
function digestText(owner:string,name:string,commits:any[],meta:any){
 const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
 const sorted=[...commits].sort((a,b)=>b.date-a.date);
 const first=sorted.length?sorted[sorted.length-1].date:0;const last=sorted.length?sorted[0].date:0;
 const spanDays=sorted.length?Math.max(1,Math.ceil((last-first)/86400000)+1):0;
 const perDay=new Map<string,number>();for(const c of sorted){const k=day(c.date);perDay.set(k,(perDay.get(k)||0)+1);}
 // 跨度过长时按天列出太长：超过 45 天按「周」聚合
 const weekly=spanDays>45;
 const buckets=new Map<string,number>();
 for(const c of sorted){const d=new Date(c.date);const key=weekly?day(d.getTime()-((d.getDay()+6)%7)*86400000)+' 起那一周':day(c.date);buckets.set(key,(buckets.get(key)||0)+1);}
 const authors=new Map<string,number>();for(const c of sorted){const a=c.author||'未知';authors.set(a,(authors.get(a)||0)+1);}
 const truncated=!!meta?.truncated;
 const head=[
  '# GitHub 巡检摘要：'+owner+'/'+name,
  '仓库创建：'+(meta?.created_at?day(Date.parse(meta.created_at)):'未知')+'；最近推送：'+(meta?.pushed_at?day(Date.parse(meta.pushed_at)):'未知')+'；默认分支：'+(meta?.default_branch||'未知'),
  '评估范围：整个仓库历史（首次提交 '+(first?day(first):'—')+' ~ 最近提交 '+(last?day(last):'—')+'，跨 '+spanDays+' 天）',
  '提交总数：'+sorted.length+(truncated?'（已截断：只取了最近的提交，更早历史未纳入）':'')+'；有提交的天数：'+perDay.size+'/'+spanDays,
  '提交者（姓名 / 提交数）：'+(authors.size?[...authors.entries()].sort((a,b)=>b[1]-a[1]).map(([a,n])=>a+' '+n).join('、'):'（无）'),
  '',
  '## '+(weekly?'按周':'按天')+'提交分布','',
  ...(buckets.size?[...buckets.entries()].sort().map(([k,n])=>'- '+k+'：'+n+' 次'):['- 仓库内没有任何提交']),
  '','## 提交明细（新→旧，最多 150 条）','',
  ...(sorted.length?sorted.slice(0,150).map(c=>'- '+new Date(c.date).toISOString().slice(0,16).replace('T',' ')+' '+c.sha+' '+(c.author||'未知')+'：'+c.message):['- （无）'])
 ];
 return head.join(NL).slice(0,20000);
}
async function repoCommits(url:string,token:string){
 const repo=parseRepo(url);need(repo,'仓库地址无效（需 https://github.com/owner/repo）',400);const {owner,name}=repo;
 const headers:any={Accept:'application/vnd.github+json','User-Agent':'course-loop',...(token?{Authorization:'Bearer '+token}:{})};
 const meta:any={};
 try{const mr=await fetch('https://api.github.com/repos/'+owner+'/'+name,{headers});if(mr.ok){const m:any=await mr.json();meta.created_at=m?.created_at||null;meta.pushed_at=m?.pushed_at||null;meta.default_branch=m?.default_branch||null;}}catch{}
 const commits:any[]=[];let truncated=false;
 try{
  for(let page=1;page<=COMMIT_PAGE_MAX;page++){
   const r=await fetch('https://api.github.com/repos/'+owner+'/'+name+'/commits?per_page=100&page='+page,{headers});
   if(!r.ok){if(page===1)throw Error('GitHub API '+r.status+(r.status===409?'（仓库为空）':(r.status===403||r.status===429)?'（已限流，建议配置 github_token）':''));truncated=true;break;}
   const arr:any=await r.json();if(!Array.isArray(arr)||!arr.length)break;
   for(const c of arr)commits.push({sha:String(c?.sha||'').slice(0,7),date:Date.parse(c?.commit?.author?.date||'')||0,author:c?.commit?.author?.name||c?.author?.login||'',message:String(c?.commit?.message||'').split(NL)[0].slice(0,120)});
   if(arr.length<100)break;
   if(page===COMMIT_PAGE_MAX)truncated=true;
  }
  meta.truncated=truncated;
  return {owner,name,commits:commits.filter(c=>c.date>0),meta};
 }catch(apiErr:any){
  // 兜底：commits.atom 免凭据、无频率限制，但只给最近 20 条
  try{
   const r=await fetch('https://github.com/'+owner+'/'+name+'/commits.atom',{headers:{'User-Agent':'course-loop'}});
   if(!r.ok)throw Error('atom '+r.status);
   const xml=await r.text();
   const list=[...xml.matchAll(/<entry>([^]*?)<[/]entry>/g)].slice(0,20).map(m=>{const e=m[1];const t=((e.match(/<title>([^]*?)<[/]title>/)||[])[1]||'').replace(/<[^>]+>/g,'').trim();const sha=((e.match(/commit[/]([0-9a-f]{7,40})/)||[])[1]||'').slice(0,7);return {sha,date:Date.parse((e.match(/<updated>([^<]+)</)||[])[1]||'')||0,author:((e.match(/<name>([^<]+)</)||[])[1]||'').trim(),message:t.slice(0,120)};});
   if(!list.length)throw Error('atom 无条目');
   return {owner,name,commits:list.filter(c=>c.date>0),meta:{...meta,truncated:true}};
  }catch{throw Error(String(apiErr?.message||apiErr).slice(0,200));}
 }
}
const ASSIST_GUIDE=`你是「小课」，课序平台的使用助手。用简洁中文回答，不知道就诚实说并建议联系教师或课程管理员，绝不编造平台功能。用户提改进意见时，感谢并引导对方点击面板上的「提改进意见」按钮记录，课程负责人会定期查阅。

平台使用指南：
- 角色：课程管理员维护课程与实验内容；教师选择课程开设课堂（每课堂独立邀请码），只看自己课堂的小组、提交与成绩；学生凭课堂邀请码加入课堂后组队做实验。
- 注册登录：邮箱+验证码；首次登录补充身份（学生/教师）与姓名，学生还要学号。
- 加入课堂：学生左侧栏「加入课堂」输入教师分享的课堂邀请码。
- Team：学生在「我的 Team」创建或接受邀请加入小组；组长邀请/转让/移除成员；每组可维护自己的 GitHub 仓库地址。
- 实验：每个实验最多提交 3 次——小组判分由组长代表小组提交，个人判分由学生本人提交；每次提交都会立即评分出分，最终成绩取最高分；截止时间由教师在课堂设置里定，教师保留修改成绩的权利。评分按评分项给分（百分制），平台会将相关且有效的提交校准到保底 60 分以上（60+0.4×评分），系统异常不会直接计零分。
- 成绩：每次提交立即评分发布，最终取最高分；学生对已发布成绩可申诉，需要澄清的内容在下次提交的说明里补充即可。
- 管理员在「连接与设置」可查看小课工作日志与 Pi/邮件连接状态。`;
export async function api(req:Request,env:Platform){
 const db=env.DB;const stmt=(s:string,...v:any[])=>db.prepare(s).bind(...v);const one=async(s:string,...v:any[])=>stmt(s,...v).first();const all=async(s:string,...v:any[])=>(await stmt(s,...v).all()).results;const run=async(s:string,...v:any[])=>stmt(s,...v).run();
 const url=new URL(req.url);const path=url.pathname.replace(/^\/api\/?/,'');const method=req.method;const devHosts=String(env.DEV_HOSTS||'').split(',').map((x:string)=>x.trim().toLowerCase()).filter(Boolean);const local=env.LOCAL_DEV==='1'&&['localhost','127.0.0.1',...devHosts].includes(url.hostname.toLowerCase());
 const record=(actor:string,action:string,target:string,detail:any)=>stmt('INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),actor,action,target,json(detail),now());
 const enqueue=(owner:string,kind:string,payload:any,courseId:string|null=null,classId:string|null=null,teamId:string|null=null,jid=id())=>({id:jid,statement:stmt('INSERT INTO jobs(id,owner,courseId,classId,teamId,kind,payload,created) VALUES(?,?,?,?,?,?,?,?)',jid,owner,courseId,classId,teamId,kind,json(payload),now())});
 const admins=()=>String(env.ADMIN_EMAILS||'').split(',').map(email).filter(Boolean);
 async function user(){const token=req.headers.get('cookie')?.match(/(?:^|;\s*)course_session=([^;]+)/)?.[1];if(token){const u=await one('SELECT users.* FROM sessions JOIN users ON sessions.userId=users.id WHERE sessions.token=? AND sessions.expires>?',await hash(token),now());if(u)return u;}
  const trusted=email(req.headers.get('oai-authenticated-user-email'));
  // Dispatch identity is trusted only on the hosted runtime; allowlist grants admin rights.
  if(!local&&trusted&&req.headers.get('oai-authenticated-user-id')&&admins().includes(trusted)){let u=await one('SELECT * FROM users WHERE email=?',trusted);if(!u){await run('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)',id(),trusted,'课程管理员','','admin',now());u=await one('SELECT * FROM users WHERE email=?',trusted);}return u;}
  return null;
 }
 async function courseAdmin(cid:string,u:any){const c=await one('SELECT * FROM courses WHERE id=?',cid);need(c,'课程不存在',404);need(u.role==='admin'||c.owner===u.id,'无权管理本课程');return c;}
 async function cls(kid:string,u:any,owner=false){const k=await one('SELECT * FROM classes WHERE id=?',kid);need(k,'课堂不存在',404);if(owner)need(k.owner===u.id||u.role==='admin');else need(k.owner===u.id||u.role==='admin'||await one('SELECT 1 FROM enrollments WHERE classId=? AND userId=?',kid,u.id));return k;}
 async function team(tid:string,u:any,leader=false){const t=await one('SELECT * FROM teams WHERE id=?',tid);need(t,'小组不存在',404);const k=await one('SELECT * FROM classes WHERE id=?',t.classId);if(k.owner!==u.id&&u.role!=='admin')need(leader?t.leader===u.id:await one('SELECT 1 FROM members WHERE teamId=? AND userId=?',tid,u.id));return {t,k};}
 async function accessibleFile(fid:string,u:any){const f=await one('SELECT * FROM files WHERE id=?',fid);need(f,'文件不存在',404);
  if(!f.classId)need(f.owner===u.id||u.role==='admin'||(f.visibility==='student'&&await one('SELECT 1 FROM classes k LEFT JOIN enrollments e ON e.classId=k.id AND e.userId=? WHERE k.courseId=? AND (k.owner=? OR e.userId IS NOT NULL)',u.id,f.courseId,u.id))); // 课程素材：上传者、admin，或共享后该课程任一课堂的师生
  else need(f.owner===u.id||u.role==='admin'||(f.teamId&&await one('SELECT 1 FROM members WHERE teamId=? AND userId=?',f.teamId,u.id))||await one('SELECT 1 FROM classes WHERE id=? AND owner=?',f.classId,u.id)); // 课堂/小组文件：上传者、组员、课堂教师、admin
  return f;}
// 评分任务只带主 rubric：实验草案里可能同时有 reportRubric（报告专用评分表），
// 若把它一起塞给模型，模型会输出 rubric.length + reportRubric.length 项，
// validateAssessment 只认 rubric 项数 → 反复重试仍失败（新生实践 e1 的 6 条失败任务即此因）。
// 网页分与报告分各自独立评分、各 100 分：web 只给 rubric，report 只给 reportRubric（改名成 rubric 供校验器复用）
const scoringExperiment=(e:any,part:string='web')=>{
 if(!e)return e;
 if(part==='report')return {...e,rubric:e.reportRubric||[],reportRubric:undefined};
 const {reportRubric:_ignored,...rest}=e;return rest;
};
const REPORT_FILE_RE=/[.](md|markdown|txt|pdf|docx|doc)$/i;
// 网页作业的评分依据是学生提供的网站地址：规范化（补协议/去尾部斜杠）+ 从提交说明里兜底提取
function normalizeSiteUrl(raw:any){
 const t=String(raw||'').trim();if(!t)return '';
 const withProto=/^https?:[\/][\/]/i.test(t)?t:('https://'+t);
 try{const u=new URL(withProto);if(u.protocol!=='https:'&&u.protocol!=='http:')return '';return u.origin+u.pathname.replace(/[\/]+$/,'/');}catch{return '';}
}
function pickSiteUrl(text:any){
 const m=String(text||'').match(/https?:[\/][\/][^\s"'<>]+/i);
 return m?normalizeSiteUrl(m[0]):'';
}
 const reportFileIds=async(fids:any[])=>{const out:string[]=[];for(const fid of fids||[]){const f=await one('SELECT name FROM files WHERE id=?',fid);if(f&&REPORT_FILE_RE.test(f.name))out.push(fid);}return out;};
 // GitHub 项目巡检（手工触发）：为指定课堂/实验下已填仓库的小组，各生成一条巡检记录与一条 repo-scan 任务。
 // 一次触发评估的是仓库的全部提交历史；正在评分中的小组会跳过，避免重复花钱。
 async function runRepoScans(actor:string,{classId=null,experimentId=null,teamId=null}:any={}){
  const out:any={scanned:0,skipped:0,failed:[] as string[],teams:0,at:now()};
  if(!classId||!experimentId)return out;
  const token=(await one("SELECT value FROM settings WHERE key='github_token'"))?.value||'';
  const k=await one('SELECT * FROM classes WHERE id=?',String(classId));if(!k)return out;
  const c=await one('SELECT * FROM courses WHERE id=?',k.courseId);if(!c?.publishedId)return out;
  const r=await one('SELECT * FROM releases WHERE id=?',c.publishedId);if(!r)return out;
  const exp=parse(r.content).experiments.find((e:any)=>e.id===String(experimentId));if(!exp||exp.grading!=='repo')return out;
  const repoTeams=await all("SELECT * FROM teams WHERE classId=? AND repo<>'' ORDER BY name",k.id);
  const teams=teamId?repoTeams.filter((t:any)=>t.id===String(teamId)):repoTeams;
  out.teams=teams.length;
  for(const t of teams){
   const pending=await one("SELECT 1 FROM submissions s JOIN jobs j ON j.id=s.jobId WHERE s.teamId=? AND s.experimentId=? AND s.mode='scan' AND j.status IN ('queued','running')",t.id,exp.id);
   if(pending){out.skipped++;continue;}
   let got:any;
   try{got=await repoCommits(t.repo,token);}
   catch(e:any){out.failed.push(k.name+' / '+t.name+'：'+String(e?.message||e).slice(0,140));continue;}
   const digest=digestText(got.owner,got.name,got.commits,got.meta);
   const last=await one("SELECT MAX(ordinal) n FROM submissions WHERE classId=? AND teamId=? AND experimentId=? AND mode='scan'",k.id,t.id,exp.id);
   const ordinal=(last?.n||0)+1;
   const mem=await all('SELECT users.id,users.name,users.email FROM members JOIN users ON members.userId=users.id WHERE members.teamId=? ORDER BY members.slot',t.id);
   const sid=id();
   const note='[GitHub 项目巡检] '+t.name+' 的仓库 '+t.repo+'；本次评估仓库全部提交历史（共 '+got.commits.length+' 条记录'+(got.meta?.truncated?'，历史较长已截断':'')+'）。无学生上传文件，评分依据为任务里的提交记录摘要。';
   const job=enqueue(actor,'repo-scan',{submissionId:sid,releaseId:r.id,revision:r.revision,experiment:scoringExperiment(exp),fileIds:[],note,members:mem,discount:0,repo:t.repo,repoDigest:digest,repoMeta:got.meta||{},scope:'full-history'},k.courseId,k.id,t.id);
   await db.batch([job.statement,stmt('INSERT INTO submissions(id,classId,teamId,studentId,experimentId,releaseId,mode,ordinal,members,fileIds,note,makeup,jobId,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sid,k.id,t.id,null,exp.id,r.id,'scan',ordinal,json(mem),'[]',note,0,job.id,now())]);
   out.scanned++;
  }
  if(out.scanned||out.failed.length)await record(actor,'repo.scan',k.id,{experimentId:exp.id,scanned:out.scanned,skipped:out.skipped,teams:out.teams,failed:out.failed.slice(0,10)}).run();
  return out;
 }
 const classCard=(x:any)=>({id:x.id,courseId:x.courseId,courseTitle:x.courseTitle,term:x.term,name:x.name,joinCode:x.joinCode,maxSize:x.maxSize,deadline:x.deadline,autoPublish:x.autoPublish,created:x.created});
 async function classDetail(k:any,u:any,tv:boolean){ // tv: 课堂教师（或 admin）视角
  const c=await one('SELECT * FROM courses WHERE id=?',k.courseId);const release=c.publishedId?await one('SELECT * FROM releases WHERE id=?',c.publishedId):null;
  const my=await one('SELECT teams.* FROM teams JOIN members ON teams.id=members.teamId WHERE members.userId=? AND members.classId=?',u.id,k.id);
  const ts=tv?await all('SELECT * FROM teams WHERE classId=?',k.id):my?[my]:[];for(const t of ts)t.members=await all('SELECT users.id,users.name,users.email,users.studentNo FROM members JOIN users ON members.userId=users.id WHERE members.teamId=? ORDER BY members.slot',t.id);
  const inv=tv?[]:await all('SELECT invites.*,teams.name as teamName FROM invites JOIN teams ON invites.teamId=teams.id WHERE teams.classId=? AND (invites.email=? OR teams.leader=?)',k.id,u.email,u.id);
  const subs=tv?await all('SELECT submissions.*,teams.name as teamName,jobs.status,jobs.error,grades.report,grades.published,report_grades.report as reportReport,report_grades.published as reportPublished FROM submissions LEFT JOIN teams ON submissions.teamId=teams.id JOIN jobs ON submissions.jobId=jobs.id LEFT JOIN grades ON grades.submissionId=submissions.id LEFT JOIN report_grades ON report_grades.submissionId=submissions.id WHERE submissions.classId=? ORDER BY submissions.created DESC',k.id):await all('SELECT submissions.*,teams.name as teamName,jobs.status,jobs.error,grades.report,grades.published,report_grades.report as reportReport,report_grades.published as reportPublished FROM submissions LEFT JOIN teams ON submissions.teamId=teams.id JOIN jobs ON submissions.jobId=jobs.id LEFT JOIN grades ON grades.submissionId=submissions.id LEFT JOIN report_grades ON report_grades.submissionId=submissions.id WHERE submissions.classId=? AND (submissions.teamId=? OR submissions.studentId=?) ORDER BY submissions.created DESC',k.id,my?.id||'',u.id);
  const ownerOf=(x:any)=>x.teamId||x.studentId;const bestOf=new Map();// 巡检类实验（grading='repo'）按「最近一次巡检」计成绩：持续开发看的是当前状态，早期高分不该锁死
const repoExps=new Set(((release?parse(release.content).experiments:[])||[]).filter((e:any)=>e.grading==='repo').map((e:any)=>e.id));
 for(const x of subs){if(!x.report)continue;const tot=parse(x.report)?.total;if(!Number.isFinite(tot))continue;const key=x.experimentId+'|'+ownerOf(x);const b=bestOf.get(key);const fresh=repoExps.has(x.experimentId)?(!b||x.ordinal>b.ordinal):(!b||tot>b.tot||(tot===b.tot&&x.ordinal>b.ordinal));if(fresh)bestOf.set(key,{id:x.id,tot,ordinal:x.ordinal});}
  // 报告分由独立任务产生，状态单独下发（网页分/报告分各自 100 分，互不影响）
  const reportJobs=await all('SELECT id,payload,status,error FROM jobs WHERE classId=? AND kind=\'grade\'',k.id);
  const reportStatus=new Map();for(const j of reportJobs){const jp=parse(j.payload,{});if(jp.part==='report')reportStatus.set(jp.submissionId,j);}
  for(const s of subs){s.superseded=subs.some((x:any)=>ownerOf(x)===ownerOf(s)&&x.experimentId===s.experimentId&&x.ordinal>s.ordinal);s.isBest=bestOf.get(s.experimentId+'|'+ownerOf(s))?.id===s.id;s.members=parse(s.members,[]);s.fileIds=parse(s.fileIds,[]);s.reviewPending=!tv&&!s.published&&!!s.report&&s.status==='complete';s.report=(tv||s.published)?parse(s.report):null;s.reportScore=(tv||s.reportPublished)?parse(s.reportReport):null;s.reportStatus=reportStatus.get(s.id)?.status||null;s.reportError=reportStatus.get(s.id)?.error||null;}

  const fs=tv?await all('SELECT id,owner,name,type,size,visibility,created,teamId,classId FROM files WHERE classId=? OR (courseId=? AND classId IS NULL AND visibility=\'student\') ORDER BY created DESC',k.id,k.courseId):await all('SELECT id,owner,name,type,size,visibility,created,teamId,classId FROM files WHERE (classId=? AND (owner=? OR teamId=?)) OR (courseId=? AND classId IS NULL AND visibility=\'student\') ORDER BY created DESC',k.id,u.id,my?.id||'',k.courseId);
  const mkOwn=await all('SELECT * FROM makeups WHERE classId=?',k.id);const makeups=mkOwn.length?mkOwn:(c.primaryClassId?await all('SELECT * FROM makeups WHERE classId=?',c.primaryClassId):[]);
  return {selected:k.id,course:{id:c.id,title:c.title,term:c.term},release:release?{id:release.id,revision:release.revision,created:release.created}:null,draft:release?parse(release.content):null,makeups,teams:ts,myTeam:tv?null:my?.id,invites:inv,submissions:subs,files:fs,appeals:tv?await all('SELECT appeals.*,users.name as userName,users.studentNo as userStudentNo,submissions.experimentId,submissions.ordinal,submissions.teamId,submissions.studentId,teams.name as teamName FROM appeals JOIN users ON users.id=appeals.userId JOIN submissions ON submissions.id=appeals.submissionId LEFT JOIN teams ON teams.id=submissions.teamId WHERE submissions.classId=? ORDER BY appeals.created DESC',k.id):await all('SELECT * FROM appeals WHERE userId=?',u.id),students:tv?await all('SELECT users.id,users.name,users.email,users.studentNo,members.teamId FROM enrollments JOIN users ON users.id=enrollments.userId LEFT JOIN members ON members.userId=users.id AND members.classId=enrollments.classId WHERE enrollments.classId=?',k.id):[]};
 }
 async function courseExtras(c:any){const release=c.publishedId?await one('SELECT * FROM releases WHERE id=?',c.publishedId):null;
  return {draft:parse(c.draft),publishedDraft:release?parse(release.content):null,release:release?{id:release.id,revision:release.revision,created:release.created}:null,makeups:await all('SELECT * FROM makeups WHERE courseId=?',c.id),messages:await all('SELECT * FROM messages WHERE courseId=? ORDER BY created',c.id),jobs:await all('SELECT id,kind,status,error,created FROM jobs WHERE courseId=? AND kind=\'draft\' ORDER BY created DESC LIMIT 30',c.id),files:await all('SELECT id,owner,name,type,size,visibility,created,teamId FROM files WHERE courseId=? AND classId IS NULL ORDER BY created DESC',c.id),courseClasses:await all('SELECT classes.id,classes.name,classes.deadline,users.name as teacherName,classes.id=courses.primaryClassId as isPrimary,(SELECT deadline FROM classes p WHERE p.id=courses.primaryClassId) as primaryDeadline,courses.primaryClassId as primaryClassId,(SELECT COUNT(*) FROM enrollments WHERE enrollments.classId=classes.id) as students,(SELECT COUNT(*) FROM teams WHERE teams.classId=classes.id) as teams FROM classes JOIN users ON users.id=classes.owner JOIN courses ON courses.id=classes.courseId WHERE classes.courseId=? ORDER BY classes.created',c.id),primaryClassId:c.primaryClassId};}
 async function snapshot(u:any){
  const health=parse((await one('SELECT value FROM settings WHERE key=\'connector_health\''))?.value,{});const base={user:u,local,devCode:local?(env.DEV_EMAIL_CODE||''):'',health:{online:now()-Math.max(health.acpAt||0,health.mailAt||0)<90000,acp:now()-(health.acpAt||0)<90000,mail:now()-(health.mailAt||0)<90000,acpFound:health.acpFound??null,acpError:health.acpError??null,mailError:health.mailError??null,piMode:health.piMode??null,piCommand:health.piCommand??null,piProvider:health.piProvider??null,piModel:health.piModel??null,piModelLock:health.piModelLock??null,piModels:parse((await one("SELECT value FROM settings WHERE key='pi_models'"))?.value,[]),piCatalog:health.piCatalog??[],piConcurrency:Number((await one("SELECT value FROM settings WHERE key='pi_concurrency'"))?.value)||1},pendingInvites:await all('SELECT invites.*,teams.name as teamName FROM invites JOIN teams ON teams.id=invites.teamId WHERE invites.email=? AND invites.status=\'pending\'',u.email),assistHistory:(await all('SELECT id,role,content,created FROM assist WHERE userId=? ORDER BY created DESC LIMIT 50',u.id)).reverse()};
  if(u.role==='admin'){
   const cs=await all('SELECT courses.*,(SELECT COUNT(*) FROM classes WHERE classes.courseId=courses.id) AS classCount FROM courses WHERE owner=? ORDER BY created',u.id);const cid=url.searchParams.get('course')||cs[0]?.id;const c=cs.find((x:any)=>x.id===cid);let extra:any={};
   if(c)extra={selected:c.id,...(await courseExtras(c))};
   return {...base,courses:cs.map((x:any)=>({id:x.id,title:x.title,term:x.term,revision:x.revision,publishedId:x.publishedId,classCount:x.classCount,created:x.created,managed:true})),classes:[],feedbackList:await all('SELECT feedback.id,feedback.content,feedback.status,feedback.created,users.name as userName,users.email as userEmail,users.role as userRole FROM feedback JOIN users ON users.id=feedback.userId ORDER BY feedback.created DESC'),...extra};
  }
  if(u.role==='teacher'){
   const courses=await all('SELECT id,title,term,owner,publishedId,revision,(SELECT COUNT(*) FROM classes WHERE classes.courseId=courses.id) AS classCount FROM courses ORDER BY created');
   const owned=courses.filter((x:any)=>x.owner===u.id);const cc=url.searchParams.get('course');const sel=cc&&owned.find((x:any)=>x.id===cc);let cextra:any={};
   // 编排数据只在显式 ?course= 时下发，且独立命名，绝不覆盖课堂的 draft/release（否则会串课）
   if(sel){const full=await one('SELECT * FROM courses WHERE id=?',sel.id);const ex=await courseExtras(full);cextra={selectedCourse:sel.id,studioDraft:ex.draft,studioPublishedDraft:ex.publishedDraft,studioRelease:ex.release,studioMessages:ex.messages,studioJobs:ex.jobs,studioFiles:ex.files,studioClasses:ex.courseClasses,studioPrimaryClassId:ex.primaryClassId,studioMakeups:ex.makeups};}
   else if(owned.length)cextra={selectedCourse:owned[0].id};
   const ks=await all('SELECT classes.*,courses.title as courseTitle,courses.term as term,courses.primaryClassId,(SELECT name FROM classes p WHERE p.id=courses.primaryClassId) as primaryName,(SELECT deadline FROM classes p WHERE p.id=courses.primaryClassId) as primaryDeadline FROM classes JOIN courses ON courses.id=classes.courseId WHERE classes.owner=? ORDER BY classes.created',u.id);
   const kid=url.searchParams.get('class')||ks[0]?.id;const k=ks.find((x:any)=>x.id===kid);return {...base,courses:courses.map((x:any)=>({...x,managed:x.owner===u.id})),classes:ks.map((x:any)=>({...classCard(x),isPrimary:x.id===x.primaryClassId,primaryClassId:x.primaryClassId,primaryName:x.primaryName,primaryDeadline:x.primaryDeadline})),...(k?await classDetail(k,u,true):{}),...cextra};
  }
  const ks=await all('SELECT classes.*,courses.title as courseTitle,courses.term as term,users.name as teacherName,courses.primaryClassId,(SELECT name FROM classes p WHERE p.id=courses.primaryClassId) as primaryName,(SELECT deadline FROM classes p WHERE p.id=courses.primaryClassId) as primaryDeadline FROM classes JOIN courses ON courses.id=classes.courseId JOIN users ON users.id=classes.owner JOIN enrollments ON enrollments.classId=classes.id AND enrollments.userId=? ORDER BY classes.created',u.id);
  const kid=url.searchParams.get('class')||ks[0]?.id;const k=ks.find((x:any)=>x.id===kid);return {...base,courses:[],classes:ks.map((x:any)=>({...classCard(x),joinCode:undefined,teacherName:x.teacherName,isPrimary:x.id===x.primaryClassId,primaryClassId:x.primaryClassId,primaryName:x.primaryName,primaryDeadline:x.primaryDeadline})),...(k?await classDetail(k,u,false):{})};
 }
 try{
  need(db,'数据库尚未就绪',503);
  if(method!=='GET'&&!path.startsWith('connector/')){const origin=req.headers.get('origin');need(!origin||origin===url.origin,'请求来源不匹配');}
  if(path==='health')return reply({ok:true,service:'course-loop'});
  if(path==='auth/request'&&method==='POST'){
   const b:any=await req.json();const em=email(b.email);need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)&&em.length<254,'请输入有效邮箱',400);const old=await one('SELECT * FROM otps WHERE email=?',em);need(!old||now()-old.sent>60000,'请在一分钟后重试',429);const health=parse((await one('SELECT value FROM settings WHERE key=\'connector_health\''))?.value,{});need(local||(now()-(health.mailAt||0)<90000),'邮件服务尚未连接，请联系课程管理员',503);
   const lastFail=await one('SELECT error,created FROM jobs WHERE kind=\'email\' AND status=\'failed\' ORDER BY created DESC LIMIT 1');need(!(lastFail&&now()-lastFail.created<20*3600000&&/quota|rate.?limit|exceeded|too many|daily/i.test(lastFail.error||'')),'今日邮件发送额度已用完，请明天再试；如有急用请联系课程管理员。',429);
   const code=local&&env.DEV_EMAIL_CODE?env.DEV_EMAIL_CODE:String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
   const mail=local?null:enqueue('system','email',{to:em,subject:'课序登录验证码',text:`你的验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略。`});await db.batch([stmt('INSERT INTO otps VALUES(?,?,0,?,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash,attempts=0,expires=excluded.expires,sent=excluded.sent',em,await hash(em+code),now()+600000,now()),...(mail?[mail.statement]:[])]);return reply({message:local?'本地开发验证码已配置，邮件未真实发送':'验证码已进入邮件投递队列'});
  }
  if(path==='auth/verify'&&method==='POST'){
   const b:any=await req.json();const em=email(b.email);const code=String(b.code||'');const o=await one('SELECT * FROM otps WHERE email=?',em);need(o&&o.expires>now()&&o.attempts<5,'验证码已失效，请重新获取',400);await run('UPDATE otps SET attempts=attempts+1 WHERE email=?',em);need(o.hash===await hash(em+code),'验证码不正确',400);const consumed=await stmt('DELETE FROM otps WHERE email=? AND hash=? AND expires>? AND attempts<=5 RETURNING email',em,o.hash,now()).first();need(consumed,'验证码已使用',400);
   let u=await one('SELECT * FROM users WHERE email=?',em);if(!u){const admin=admins().includes(em);await run('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)',id(),em,admin?'课程管理员':'','',admin?'admin':'pending',now());u=await one('SELECT * FROM users WHERE email=?',em);}
   const token=id()+id();await run('INSERT INTO sessions VALUES(?,?,?)',await hash(token),u.id,now()+7*86400000);return reply({user:u},200,{'Set-Cookie':`course_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${url.protocol==='https:'?'; Secure':''}`});
  }
  if(path==='auth/logout'){const token=req.headers.get('cookie')?.match(/course_session=([^;]+)/)?.[1];if(token)await run('DELETE FROM sessions WHERE token=?',await hash(token));return reply({ok:true},200,{'Set-Cookie':'course_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  // Connector calls use a separate bearer capability, never a student session.
  if(path.startsWith('connector/')){
   const secret=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';const stored=await one('SELECT value FROM settings WHERE key=\'connector_token\'');need(stored&&stored.value===await hash(secret),'连接器凭据无效',401);
   if(path==='connector/poll'&&method==='POST'){const b:any=await req.json();const h=parse((await one("SELECT value FROM settings WHERE key='connector_health'"))?.value,{});await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','connector_health',json({...h,...(b.acp?{acpAt:now()}:{}),...(b.mail?{mailAt:now()}: {})}));await run('UPDATE jobs SET status=\'failed\',error=\'连接器任务超时，请重试\',finished=? WHERE status=\'running\' AND expires<?',now(),now());const kinds=[...(b.acp?['draft','grade','repo-scan']:[]),...(b.mail?['email']:[])];if(!kinds.length)return reply({job:null});const lease=id();const job=await stmt(`UPDATE jobs SET status='running',lease=?,expires=?,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='queued' AND kind IN (${kinds.map(()=>'?').join(',')}) ORDER BY created LIMIT 1) AND status='queued' RETURNING *`,lease,now()+900000,...kinds).first();if(!job)return reply({job:null});const payload=parse(job.payload,{});const fids=payload.fileIds||[];const attachments=[];for(const fid of fids){const f=await one('SELECT id,name,type,size FROM files WHERE id=? AND courseId=?',fid,job.courseId);if(f)attachments.push(f);}return reply({job:{...job,payload,files:attachments}});}
   const parts=path.split('/');const jid=parts[2];const j=await one('SELECT * FROM jobs WHERE id=?',jid);need(j,'任务不存在',404);const lease=req.headers.get('x-job-lease');need(j.lease===lease&&j.status==='running'&&j.expires>now(),'任务租约已失效',409);
   if(parts[1]==='file'){const fid=parts[3];need(parse(j.payload,{}).fileIds?.includes(fid),'文件不属于任务');const f=await one('SELECT * FROM files WHERE id=?',fid);const obj=await env.FILES.get(f.key);need(obj,'文件不存在',404);return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream'}});}
   if(parts[1]==='heartbeat'){await run('UPDATE jobs SET expires=? WHERE id=?',now()+900000,j.id);const h=parse((await one("SELECT value FROM settings WHERE key='connector_health'"))?.value,{});await run("UPDATE settings SET value=? WHERE key='connector_health'",json({...h,[j.kind==='email'?'mailAt':'acpAt']:now()}));return reply({ok:true});}
   if(parts[1]==='finish'&&method==='POST'){
    const b:any=await req.json();const p=parse(j.payload,{});if(b.error){await run('UPDATE jobs SET status=\'failed\',error=?,finished=? WHERE id=? AND lease=?',String(b.error).slice(0,2000),now(),j.id,lease);return reply({ok:true});}
    const mutations=[];let result=b.result;
    if(j.kind==='draft'){const d=validateDraft(result.draft);const c=await one('SELECT * FROM courses WHERE id=?',j.courseId);need(c.revision===p.revision,'课程已变化，请重新发起分析',409);mutations.push(stmt('UPDATE courses SET draft=?,title=?,term=?,revision=revision+1 WHERE id=? AND revision=?',json(d),d.title,d.term||c.term,c.id,p.revision),stmt('INSERT INTO messages VALUES(?,?,?,?,?,?)',j.id,c.id,'assistant',text(result.message||'课程草案已更新，请预览后确认发布。'),json([]),now()));}
    if(j.kind==='grade'||j.kind==='repo-scan'){
     result=validateAssessment(result,p.experiment);const disc=Number(p.discount)||0;
     if(disc>0&&disc<=90){const k=1-disc/100;for(const it of result.items)it.score=Math.round(it.score*k*100)/100;result.total=Math.round(result.items.reduce((n:number,x:any)=>n+x.score,0)*100)/100;result.makeup={discount:disc};}
     // 报告分任务的 jobId 不在 submissions.jobId（那条存网页分任务），按 payload.submissionId 取
     const sub=p.submissionId?await one('SELECT * FROM submissions WHERE id=?',p.submissionId):await one('SELECT * FROM submissions WHERE jobId=?',j.id);
     const table=p.part==='report'?'report_grades':'grades';
     mutations.push(stmt('INSERT INTO '+table+'(submissionId,report,published,updated) VALUES(?,?,?,?) ON CONFLICT(submissionId) DO UPDATE SET report=excluded.report,published=excluded.published,updated=excluded.updated',sub.id,json(result),1,now()));
    }
    if(j.kind==='email'){result={delivered:true};mutations.push(stmt('UPDATE jobs SET payload=? WHERE id=?',json({delivered:true}),j.id));}
    mutations.push(stmt('UPDATE jobs SET status=\'complete\',result=?,error=NULL,finished=? WHERE id=? AND lease=? AND status=\'running\'',json(result),now(),j.id,lease));await db.batch(mutations);return reply({ok:true});
   }return reply({error:'连接器操作不存在'},404);
  }
  const u=await user();
  if(path==='state')return reply(u?await snapshot(u):{user:null,courses:[],classes:[],local,devCode:local?(env.DEV_EMAIL_CODE||''):''});
  need(u,'请先登录',401);
  if(path==='auth/profile'&&method==='POST'){const b:any=await req.json();need(u.role==='pending','身份信息已完善',409);need(b.role==='teacher'||b.role==='student','身份类型无效',400);const name=text(b.name,80);const sn=b.role==='student'?text(b.studentNo,40):'';await run('UPDATE users SET role=?,name=?,studentNo=? WHERE id=?',b.role,name,sn,u.id);return reply({user:{...u,role:b.role,name,studentNo:sn}});}
  need(u.role!=='pending','请先完善个人信息',403);
  if(path==='pi-concurrency'&&method==='POST'){need(u.role==='admin');const b:any=await req.json();const n=Number(b.count);need(Number.isInteger(n)&&n>=1&&n<=8,'并发数应为 1–8 的整数',400);
   await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','pi_concurrency',String(n));await record(u.id,'pi.concurrency',String(n),{}).run();
   return reply({ok:true,count:n});}
  if(path==='pi-model'&&method==='POST'){need(u.role==='admin');const b:any=await req.json();const m=String(b.model||'').trim();need(m&&m.length<=120,'请输入有效的模型名称',400);
   await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','pi_model',m);
   const cur=parse((await one("SELECT value FROM settings WHERE key='pi_models'"))?.value,[]);const models=[m,...cur.filter((x:any)=>x!==m)].slice(0,20);
   await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','pi_models',json(models));
   env.piRescan?.();await record(u.id,'pi.model',m,{models}).run();
   return reply({ok:true,models});}
  if(path==='job-log'&&method==='GET'){need(u.role==='admin');const page=Math.max(1,Number(url.searchParams.get('page'))||1);const size=20;const total=(await one('SELECT COUNT(*) n FROM jobs'))?.n||0;const items=await all('SELECT id,kind,status,error,attempts,created,finished FROM jobs ORDER BY created DESC LIMIT ? OFFSET ?',size,(page-1)*size);return reply({items,total,page,pageSize:size});}
  if(path==='assist'&&method==='POST'){const b:any=await req.json();const content=text(b.message);await run('INSERT INTO assist VALUES(?,?,?,?,?)',id(),u.id,'user',content,now());
   const history=(await all('SELECT role,content FROM assist WHERE userId=? ORDER BY created DESC LIMIT 20',u.id)).reverse();
   need(env.runAssist,'小课暂时不可用：未检测到 Pi。你可以先用「提改进意见」记录问题，或稍后再试。',503);
   const prompt=ASSIST_GUIDE+'\n\n对话历史（含用户最新问题）：\n'+history.map((h:any)=>(h.role==='user'?'用户':'小课')+'：'+h.content).join('\n')+'\n\n请用简洁中文回答用户最新的问题。';
   const answer=String(await env.runAssist(prompt)||'').trim();need(answer,'小课没有返回内容，请稍后再试。',503);
   await run('INSERT INTO assist VALUES(?,?,?,?,?)',id(),u.id,'assistant',answer,now());return reply({reply:answer});}
  if(path==='feedback'&&method==='POST'){const b:any=await req.json();await run('INSERT INTO feedback VALUES(?,?,?,?,?)',id(),u.id,text(b.content,2000),'open',now());return reply({ok:true});}
  if(path==='feedback-action'&&method==='POST'){need(u.role==='admin');const b:any=await req.json();need(b.action==='close'||b.action==='open','操作无效',400);const f=await one('SELECT * FROM feedback WHERE id=?',String(b.id||''));need(f,'意见不存在',404);await run('UPDATE feedback SET status=? WHERE id=?',b.action==='close'?'closed':'open',f.id);await record(u.id,'feedback.'+b.action,f.id,{}).run();return reply({ok:true});}
  if(path==='courses'&&method==='POST'){need(u.role==='admin'||u.role==='teacher','仅教师可建课',403);const b:any=await req.json();let d:any;if(b.copyId){const c=await courseAdmin(b.copyId,u);d=parse(c.draft);}else d={title:'未命名课程',term:'',description:'',experiments:[],questions:[]};if(b.term)d.term=text(b.term,100);if(b.title)d.title=text(b.title,160);const cid=id();await run('INSERT INTO courses(id,owner,title,term,draft,created) VALUES(?,?,?,?,?,?)',cid,u.id,d.title,d.term,json(d),now());return reply({id:cid});}
  if(path==='course-delete'&&method==='POST'){const b:any=await req.json();const c=await courseAdmin(String(b.courseId||''),u);need(!await one('SELECT 1 FROM classes WHERE courseId=?',c.id),'该课程下已有老师开设课堂，不能删除',409);const fs=await all('SELECT key FROM files WHERE courseId=? AND classId IS NULL',c.id);for(const f of fs)await env.FILES.delete?.(f.key).catch(()=>{});await db.batch([stmt('DELETE FROM files WHERE courseId=? AND classId IS NULL',c.id),stmt('DELETE FROM messages WHERE courseId=?',c.id),stmt('DELETE FROM makeups WHERE courseId=?',c.id),stmt('DELETE FROM releases WHERE courseId=?',c.id),stmt('DELETE FROM jobs WHERE courseId=? AND classId IS NULL',c.id),stmt('DELETE FROM courses WHERE id=?',c.id),record(u.id,'course.delete',c.id,{title:c.title})]);return reply({ok:true});}
  if(path==='course-export'&&method==='GET'){const c=await courseAdmin(String(url.searchParams.get('course')||''),u);const d=parse(c.draft);const payload=JSON.stringify({format:'course-loop-course',version:1,exported:now(),course:d},null,2);const name=encodeURIComponent((d.title||'course').replace(/[\\/\x00-\x1f]/g,'_'))+'.json';return new Response(payload,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${name}`,'Cache-Control':'no-store'}});}
  // 名单导出：scope=member 一人一行（含成绩）；scope=team 一队一行（成员合并，不含成绩）
  if(path==='class-roster'&&method==='GET'){const k=await cls(String(url.searchParams.get('classId')||''),u,true);const c=await one('SELECT * FROM courses WHERE id=?',k.courseId);
   const teams=await all('SELECT * FROM teams WHERE classId=? ORDER BY created',k.id);
   const roster=await all('SELECT u.id,u.name,u.studentNo,u.email,m.teamId FROM enrollments e JOIN users u ON u.id=e.userId LEFT JOIN members m ON m.userId=u.id AND m.classId=e.classId WHERE e.classId=? ORDER BY u.studentNo,u.name',k.id);
   const esc=(v:any)=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
   const pad=(n:number)=>String(n).padStart(2,'0');const day=(ms:number)=>{const d=new Date(ms);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
   const csvOf=(rows:any[][],title:string)=>{const csv='\ufeff'+rows.map((r:any[])=>r.map(esc).join(',')).join('\r\n')+'\r\n';const fname=encodeURIComponent(title+'-'+k.name+'-'+day(now())+'.csv');return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${fname}`,'Cache-Control':'no-store'}});};
   if(String(url.searchParams.get('scope')||'member')==='team'){
     const mems=await all('SELECT m.teamId,m.userId,u.name,u.studentNo FROM members m JOIN users u ON u.id=m.userId WHERE m.classId=? ORDER BY m.slot',k.id);
     const rows:any[][]=[['课堂','课程','团队','人数','组长','成员','GitHub 仓库','创建时间']];
     for(const t of teams){const ms=mems.filter((m:any)=>m.teamId===t.id);const leader=ms.find((m:any)=>m.userId===t.leader);rows.push([k.name,c.title,t.name,String(ms.length),leader?leader.name+'（'+leader.studentNo+'）':'',ms.map((m:any)=>m.name+'（'+m.studentNo+'）').join('；'),t.repo||'',day(t.created)]);}
     const inTeam=new Set(mems.map((m:any)=>m.userId));const loose=roster.filter((r:any)=>!inTeam.has(r.id));
     if(String(url.searchParams.get('format')||'csv')==='xlsx'){
       const maxN=Math.max(1,...teams.map((t:any)=>mems.filter((m:any)=>m.teamId===t.id).length));
       const head=['团队','人数','组长',...Array.from({length:maxN},(_,i)=>'成员'+(i+1)),'GitHub 仓库','创建时间'];
       const s1:any[][]=[head];const s2:any[][]=[['团队','姓名','学号','角色']];
       for(const t of teams){const ms=mems.filter((m:any)=>m.teamId===t.id);const leader=ms.find((m:any)=>m.userId===t.leader);
         s1.push([t.name,ms.length,leader?leader.name+'（'+leader.studentNo+'）':'',...Array.from({length:maxN},(_,i)=>ms[i]?ms[i].name+'（'+ms[i].studentNo+'）':''),t.repo||'',day(t.created)]);
         for(const m of ms)s2.push([t.name,m.name,m.studentNo,m.userId===t.leader?'组长':'成员']);}
       for(const r of loose){s1.push(['（未分组）',1,r.name+'（'+r.studentNo+'）',r.name+'（'+r.studentNo+'）',...Array.from({length:maxN-1},()=>''),'','']);s2.push(['（未分组）',r.name,r.studentNo,'']);}
       const buf=await buildXlsx([{name:'小组',rows:s1,widths:[20,6,22,...Array.from({length:maxN},()=>24),44,12]},{name:'成员',rows:s2,widths:[20,12,18,8]}]);
       const xname=encodeURIComponent('小组名单-'+k.name+'-'+day(now())+'.xlsx');
       return new Response(buf,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${xname}`,'Cache-Control':'no-store'}});
     }
     for(const r of loose)rows.push([k.name,c.title,'（未分组）','1',r.name+'（'+r.studentNo+'）',r.name+'（'+r.studentNo+'）','','']);
     return csvOf(rows,'小组名单');
   }
   const rel=c.publishedId?await one('SELECT * FROM releases WHERE id=?',c.publishedId):null;const d=rel?parse(rel.content):parse(c.draft);const exps=(d.experiments||[]).filter((e:any)=>e.grading!=='none');
   const mems=await all('SELECT teamId,userId FROM members WHERE classId=?',k.id);
   const subs=await all('SELECT s.teamId,s.studentId,s.experimentId,s.mode,s.ordinal,g.report FROM submissions s LEFT JOIN grades g ON g.submissionId=s.id WHERE s.classId=?',k.id);
   const reportSubs=await all('SELECT s.teamId,s.studentId,s.experimentId,g.report FROM report_grades g JOIN submissions s ON s.id=g.submissionId WHERE s.classId=?',k.id);
   const cnt:Map<string,number>=new Map(),scanCnt:Map<string,number>=new Map(),best:Map<string,{tot:number,ordinal:number}>=new Map();
   const reportBest:Map<string,number>=new Map();for(const r of reportSubs){const owner=r.teamId||r.studentId;if(!owner)continue;const kk=owner+'|'+r.experimentId;const tot=r.report?parse(r.report)?.total:null;if(Number.isFinite(tot)&&(reportBest.get(kk)===undefined||tot>reportBest.get(kk)!))reportBest.set(kk,tot);}for(const s of subs){const owner=s.teamId||s.studentId;if(!owner)continue;const kk=owner+'|'+s.experimentId;if(s.mode==='scan')scanCnt.set(kk,(scanCnt.get(kk)||0)+1);else cnt.set(kk,(cnt.get(kk)||0)+1);const rep=s.report?parse(s.report):null;const tot=rep&&Number.isFinite(rep.total)?rep.total:null;const prev=best.get(kk);// 巡检类实验取「最近一次巡检」，其余实验仍取最高分
const repoExp=exps.some((e:any)=>e.id===s.experimentId&&e.grading==='repo');if(tot!==null&&(prev===undefined||(repoExp?s.ordinal>prev.ordinal:tot>prev.tot)))best.set(kk,{tot,ordinal:s.ordinal||0});}
   const header=['课堂','课程','团队','成员姓名','学号','邮箱','角色','GitHub 仓库','团队人数',...exps.flatMap((e:any)=>[e.title+(e.grading==='repo'?' 巡检次数':' 提交次数'),e.title+' 最高分',...((e.reportRubric||[]).length?[e.title+' 报告最高分']:[])]),'已提交实验数','总评'];
   const rows:any[][]=[header];
   for(const r of roster){const t=r.teamId?teams.find((x:any)=>x.id===r.teamId):null;const size=t?mems.filter((m:any)=>m.teamId===t.id).length:null;
    const row:any[]=[k.name,c.title,t?t.name:'（未分组）',r.name,r.studentNo,r.email,t?(t.leader===r.id?'组长':'成员'):'',t?t.repo:'',size===null?'':String(size)];
    let sum=0,submitted=0;for(const e of exps){const owner=e.grading==='individual'?r.id:(t?t.id:null);const kk=owner?owner+'|'+e.id:'';const n=kk?((e.grading==='repo'?scanCnt:cnt).get(kk)||0):0;const b=kk&&best.has(kk)?best.get(kk)!.tot:null;row.push(String(n),b===null?'':String(b));
    if((e.reportRubric||[]).length){const rb=kk?reportBest.get(kk):null;row.push(rb===undefined||rb===null?'':String(rb));}
    if(n>0||b!==null)submitted++;sum+=b===null?0:b;}
    row.push(String(submitted),exps.length?(Math.round(sum/exps.length*10)/10).toFixed(1):'');rows.push(row);}
   return csvOf(rows,'名单');}
  if(path==='course-import'&&method==='POST'){need(u.role==='admin'||u.role==='teacher','仅教师可导入课程',403);const b:any=await req.json();const raw=b.course;need(raw&&typeof raw==='object','课程数据无效',400);let d:any;if(Array.isArray(raw.experiments)&&raw.experiments.length)d=validateDraft(raw);else{need(typeof raw.title==='string'&&raw.title.trim(),'课程数据缺少标题或实验',400);d={title:text(raw.title,160),term:String(raw.term||'').slice(0,100),description:String(raw.description||'').slice(0,20000),experiments:[],questions:[]};}if(b.title)d.title=text(b.title,160);const cid=id();await run('INSERT INTO courses(id,owner,title,term,draft,created) VALUES(?,?,?,?,?,?)',cid,u.id,d.title,d.term,json(d),now());await record(u.id,'course.import',cid,{title:d.title}).run();return reply({id:cid});}
  if(path==='course-primary'&&method==='POST'){const b:any=await req.json();const c=await courseAdmin(String(b.courseId||''),u);const kid=String(b.classId||'');if(kid){const k=await one('SELECT * FROM classes WHERE id=?',kid);need(k&&k.courseId===c.id,'课堂不属于该课程',400);}await run('UPDATE courses SET primaryClassId=? WHERE id=?',kid||null,c.id);await record(u.id,'course.primary',c.id,{classId:kid||null}).run();return reply({ok:true});}
  if(path==='course-transfer'&&method==='POST'){const b:any=await req.json();const c=await one('SELECT * FROM courses WHERE id=?',String(b.courseId||''));need(c,'课程不存在',404);need(u.role==='admin','仅管理员可移交课程',403);const target=await one('SELECT * FROM users WHERE email=?',email(String(b.email||'')));need(target&&(target.role==='teacher'||target.role==='admin'),'移交对象须为教师或管理员',400);await run('UPDATE courses SET owner=? WHERE id=?',target.id,c.id);await record(u.id,'course.transfer',c.id,{to:target.email,from:c.owner}).run();return reply({ok:true,ownerId:target.id});}
  if(path==='makeup-set'&&method==='POST'){const b:any=await req.json();const klassId=String(b.classId||'');const k=await one('SELECT * FROM classes WHERE id=?',klassId);need(k,'课堂不存在',404);need(k.owner===u.id||u.role==='admin','只有本课堂教师可设置补交',403);const start=b.start?Date.parse(b.start):null;const end=b.end?Date.parse(b.end):null;const disc=b.discount===undefined||b.discount===null||b.discount===''?null:Number(b.discount);
   if(start===null&&end===null&&disc===null){await run('DELETE FROM makeups WHERE classId=?',k.id);await record(u.id,'makeup.clear',k.id,{}).run();return reply({ok:true,cleared:true});}
   need(start!==null&&end!==null&&Number.isFinite(start)&&Number.isFinite(end),'请设置补交起止时间',400);need(start<end,'补交开始时间必须早于结束时间',400);need(Number.isInteger(disc)&&(disc as number)>=1&&(disc as number)<=90,'折扣应为 1–90 的整数百分比',400);
   await run('DELETE FROM makeups WHERE classId=?',k.id);
   await run('INSERT INTO makeups(courseId,experimentId,classId,start,end,discount,updated) VALUES(?,?,?,?,?,?,?)',k.courseId,'',k.id,start,end,disc,now());await record(u.id,'makeup.set',k.id,{start,end,discount:disc}).run();return reply({ok:true});}
  // 手工补交：教师代指定学生（个人判分）或该生所在小组（小组判分）补交指定实验，折扣固定 20%，与学生自助补交窗口无关
  if(path==='makeup-submit'&&method==='POST'){const b:any=await req.json();const k=await cls(String(b.classId||''),u,true);const c=await one('SELECT * FROM courses WHERE id=?',k.courseId);need(c.publishedId,'课程尚未发布',400);
   const r=await one('SELECT * FROM releases WHERE id=?',c.publishedId);const exp=parse(r.content).experiments.find((e:any)=>e.id===String(b.experimentId||''));need(exp,'实验不存在',400);need(exp.grading!=='none','该实验无需提交，不计成绩',400);need(exp.grading!=='repo','该实验由平台每日巡检评分，无需提交',400);
   const st=await one('SELECT users.* FROM enrollments JOIN users ON users.id=enrollments.userId WHERE enrollments.classId=? AND enrollments.userId=?',k.id,String(b.studentId||''));need(st,'该学生不在本课堂',400);
   const fids=Array.isArray(b.fileIds)?b.fileIds.slice(0,20):[];need(fids.length,'请先上传要代交的作业文件',400);
   const individual=exp.grading==='individual';let t:any=null;let mem:any[]=[];
   if(individual)mem=[{id:st.id,name:st.name,email:st.email}];
   else{t=await one('SELECT teams.* FROM teams JOIN members ON members.teamId=teams.id WHERE teams.classId=? AND members.userId=?',k.id,st.id);need(t,'该学生尚未加入小组，无法代表小组补交',400);mem=await all('SELECT users.id,users.name,users.email FROM members JOIN users ON members.userId=users.id WHERE members.teamId=? ORDER BY members.slot',t.id);}
   for(const fid of fids){const f=await one('SELECT * FROM files WHERE id=?',fid);need(f,'文件不存在',404);need(f.classId===k.id,'文件不属于本课堂',400);need(f.owner===u.id||u.role==='admin'||(individual?f.owner===st.id:f.teamId===t.id),'只能使用本课堂的作业文件',403);}
   const ownerCol=individual?'studentId':'teamId';const ownerVal=individual?st.id:t.id;const last=await one(`SELECT MAX(ordinal) as n FROM submissions WHERE ${ownerCol}=? AND experimentId=? AND mode<>'scan'`,ownerVal,exp.id);const ordinal=(last?.n||0)+1;
   const discount=20;const note='[教师手工补交] '+(String(b.note||'').trim().slice(0,19900)||'教师为该学生安排的课后补交，评分依据为教师上传的作业文件。');
   const sid=id();
   const job=enqueue(u.id,'grade',{submissionId:sid,releaseId:r.id,revision:r.revision,part:'web',experiment:scoringExperiment(exp,'web'),fileIds:fids,note,members:mem,discount},k.courseId,k.id,t?.id||null);
   const stmts=[job.statement,stmt('INSERT INTO submissions(id,classId,teamId,studentId,experimentId,releaseId,mode,ordinal,members,fileIds,note,makeup,jobId,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sid,k.id,t?.id||null,individual?st.id:null,exp.id,r.id,'formal',ordinal,json(mem),json(fids),note,discount,job.id,now())];
   if((exp.reportRubric||[]).length){
    const rids=await reportFileIds(fids);
    const rjob=enqueue(u.id,'grade',{submissionId:sid,releaseId:r.id,revision:r.revision,part:'report',experiment:scoringExperiment(exp,'report'),fileIds:rids,note:'[实验报告评分] 只依据提交的实验报告文档评分，不读取网页源码、不检查线上页面。',members:mem,discount:0},k.courseId,k.id,t?.id||null);
    stmts.push(rjob.statement);
   }
   await db.batch(stmts);return reply({id:sid,ordinal,discount,teamId:t?.id||null});}
  // 手工巡检：教师/管理员触发一次，立即为已填仓库的小组各建一条任务（评估整仓历史；进行中的小组跳过）
  if(path==='repo-scan-now'&&method==='POST'){const b:any=await req.json();const k=await cls(String(b.classId||''),u,true);const r=await runRepoScans(u.id,{classId:k.id,experimentId:b.experimentId?String(b.experimentId):null,teamId:b.teamId?String(b.teamId):null,force:true});return reply(r);}
  // 课堂只能在自己负责的课程之间改绑；已有人/组/提交/文件的课堂一律拒绝，避免带走教学记录
  const classEmpty=async(k:any)=>{const n=await one('SELECT (SELECT COUNT(*) FROM enrollments WHERE classId=?) e,(SELECT COUNT(*) FROM teams WHERE classId=?) t,(SELECT COUNT(*) FROM submissions WHERE classId=?) s,(SELECT COUNT(*) FROM files WHERE classId=?) f',k.id,k.id,k.id,k.id);return !n.e&&!n.t&&!n.s&&!n.f;};
  if(path==='class-rebind'&&method==='POST'){const b:any=await req.json();const k=await one('SELECT * FROM classes WHERE id=?',String(b.classId||''));need(k,'课堂不存在',404);need(k.owner===u.id||u.role==='admin','只有本课堂教师可以更换课程',403);
   const c=await one('SELECT * FROM courses WHERE id=?',String(b.courseId||''));need(c,'课程不存在',404);need(c.owner===u.id||u.role==='admin','只能换到自己负责的课程',403);need(c.id!==k.courseId,'课堂已经在这门课程下',409);
   need(await classEmpty(k),'课堂已有学生/小组/提交，不能更换课程；请另开一个新课堂',409);
   await db.batch([stmt('DELETE FROM makeups WHERE classId=?',k.id),stmt('UPDATE classes SET courseId=? WHERE id=?',c.id,k.id),record(u.id,'class.rebind',k.id,{from:k.courseId,to:c.id})]);
   return reply({ok:true,courseId:c.id});}
  // 删除课堂：同样只允许空课堂（学生/小组/提交/文件任一存在就拒绝）
  if(path==='class-delete'&&method==='POST'){const b:any=await req.json();const k=await one('SELECT * FROM classes WHERE id=?',String(b.classId||''));need(k,'课堂不存在',404);need(k.owner===u.id||u.role==='admin','只有本课堂教师可以删除课堂',403);
   need(await classEmpty(k),'课堂已有学生/小组/提交，不能删除',409);
   await db.batch([stmt('DELETE FROM makeups WHERE classId=?',k.id),stmt('DELETE FROM jobs WHERE classId=?',k.id),stmt('DELETE FROM invites WHERE teamId IN (SELECT id FROM teams WHERE classId=?)',k.id),stmt('UPDATE courses SET primaryClassId=NULL WHERE primaryClassId=?',k.id),stmt('DELETE FROM classes WHERE id=?',k.id),record(u.id,'class.delete',k.id,{name:k.name,courseId:k.courseId})]);
   return reply({ok:true});}
  if(path==='classes'&&method==='POST'){need(u.role==='teacher');const b:any=await req.json();const c=await one('SELECT * FROM courses WHERE id=?',String(b.courseId||''));need(c,'课程不存在',404);const name=b.name?text(b.name,60):'未命名课堂';const kid=id();let code='';for(let i=0;i<5;i++){code=id().replaceAll('-','').slice(0,10).toUpperCase();if(!await one('SELECT 1 FROM classes WHERE joinCode=?',code))break;}await run('INSERT INTO classes(id,courseId,owner,name,joinCode,created) VALUES(?,?,?,?,?,?)',kid,c.id,u.id,name,code,now());return reply({id:kid,joinCode:code});}
  if(path==='join'&&method==='POST'){need(u.role==='student');const b:any=await req.json();const k=await one('SELECT * FROM classes WHERE joinCode=?',String(b.code||'').trim().toUpperCase());need(k,'课堂邀请码无效',400);await run('INSERT OR IGNORE INTO enrollments VALUES(?,?)',k.id,u.id);return reply({id:k.id});}
  if(path==='pair'&&method==='POST'){need(u.role==='admin');const token=id()+id();await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','connector_token',await hash(token));await record(u.id,'connector.rotate','connector',{}).run();return reply({token});}
  if(path==='upload'&&method==='POST'){const form=await req.formData();const cid=String(form.get('courseId')||'');const kid=String(form.get('classId')||'');const tid=String(form.get('teamId')||'');need(!!cid!==!!kid,'文件必须归属一门课程或一个课堂',400);let courseId=cid,classId:string|null=null,material=false;
   if(cid){await courseAdmin(cid,u);need(!tid,'课程素材不属于小组',400);material=true;}
   else{const k=await one('SELECT * FROM classes WHERE id=?',kid);need(k,'课堂不存在',404);need(k.owner===u.id||u.role==='admin'||await one('SELECT 1 FROM enrollments WHERE classId=? AND userId=?',kid,u.id));courseId=k.courseId;classId=kid;if(tid){const tk=await team(tid,u);need(tk.k.id===kid,'小组不属于该课堂',400);}}
   const f=form.get('file') as File;need(f&&typeof f.arrayBuffer==='function'&&f.size>0,'请选择要上传的文件',400);need(f.size<=(classId?5*1024*1024:20*1024*1024),classId?'单个作业文件不能超过 5 MB，请压缩后分批上传':'文件大小应在 1 字节至 20 MB 之间',400);need(/\.(md|txt|pdf|docx|zip|json|jsonl|csv|py|png|jpg|jpeg|mp4)$/i.test(f.name),'暂不支持该文件类型',400);const fid=id();const name=f.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);const visibility=material&&form.get('visibility')==='student'?'student':'private';await env.FILES.put(fid,await f.arrayBuffer(),{httpMetadata:{contentType:f.type||'application/octet-stream'}});await run('INSERT INTO files(id,owner,courseId,classId,teamId,key,name,type,size,visibility,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',fid,u.id,courseId,classId,tid||null,fid,name,f.type,f.size,visibility,now());return reply({id:fid,name});}
  if(path.startsWith('files/')&&method==='GET'){const f=await accessibleFile(path.split('/')[1],u);const obj=await env.FILES.get(f.key);need(obj,'文件不存在',404);return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'X-Content-Type-Options':'nosniff'}});}
  if(path==='file-visibility'&&method==='POST'){const b:any=await req.json();const f=await one('SELECT * FROM files WHERE id=?',b.id);need(f,'文件不存在',404);await courseAdmin(f.courseId,u);need(!f.classId,'课堂文件不能公开为课程素材',400);await run('UPDATE files SET visibility=? WHERE id=?',b.shared?'student':'private',f.id);await record(u.id,'file.visibility',f.id,{shared:!!b.shared}).run();return reply({ok:true});}
  if(path==='file-delete'&&method==='POST'){const b:any=await req.json();const f=await one('SELECT * FROM files WHERE id=?',b.id);need(f,'文件不存在',404);await courseAdmin(f.courseId,u);need(!f.classId,'课堂与作业文件属于教学记录，不能删除',400);await env.FILES.delete?.(f.key).catch(()=>{});await run('DELETE FROM files WHERE id=?',f.id);await record(u.id,'file.delete',f.id,{name:f.name}).run();return reply({ok:true});}
  if(path==='chat'&&method==='POST'){const b:any=await req.json();const c=await courseAdmin(b.courseId,u);need(!await one('SELECT 1 FROM jobs WHERE courseId=? AND kind=\'draft\' AND status IN (\'queued\',\'running\')',c.id),'上一条课程分析尚未完成，可取消后重试',409);const fids=Array.isArray(b.fileIds)?b.fileIds.slice(0,10):[];for(const fid of fids){const f=await accessibleFile(fid,u);need(f.courseId===c.id&&!f.classId,'附件不属于本课程素材');}const history=await all('SELECT role,content FROM messages WHERE courseId=? ORDER BY created DESC LIMIT 20',c.id);const content=text(b.message);const job=enqueue(u.id,'draft',{draft:parse(c.draft),revision:c.revision,message:content,history:history.reverse(),fileIds:fids},c.id);await db.batch([stmt('INSERT INTO messages VALUES(?,?,?,?,?,?)',id(),c.id,'user',content,json(fids),now()),job.statement]);return reply({jobId:job.id});}
  if(path==='publish'&&method==='POST'){const b:any=await req.json();const c=await courseAdmin(b.courseId,u);need(c.revision===b.revision,'草案已变化，请重新预览',409);const d=validateDraft(parse(c.draft));need(!d.questions.length&&!d.experiments.some(e=>e.questions?.length),'请先通过对话解决待确认事项',400);need(!await one('SELECT 1 FROM jobs WHERE courseId=? AND kind=\'draft\' AND status IN (\'queued\',\'running\')',c.id),'分析尚未完成，暂不能发布',409);const rid=id();await db.batch([stmt('INSERT INTO releases VALUES(?,?,?,?,?)',rid,c.id,c.revision,json(d),now()),stmt('UPDATE courses SET publishedId=? WHERE id=?',rid,c.id),record(u.id,'course.publish',c.id,{revision:c.revision})]);return reply({id:rid});}
  if(path==='class-settings'&&method==='POST'){const b:any=await req.json();const k=await cls(b.classId,u,true);const n=Number(b.maxSize);need(Number.isInteger(n)&&n>=1&&n<=16,'小组上限应为 1–16',400);const max=await one('SELECT COUNT(*) as n FROM members WHERE classId=? GROUP BY teamId ORDER BY n DESC LIMIT 1',k.id);need(n>=(max?.n||0),'已有小组人数超过新上限',400);const deadline=b.deadline?Date.parse(b.deadline):null;need(deadline===null||Number.isFinite(deadline),'截止时间无效',400);await run('UPDATE classes SET maxSize=?,deadline=?,autoPublish=? WHERE id=?',n,deadline,b.autoPublish?1:0,k.id);return reply({ok:true});}
  if(path==='teams'&&method==='POST'){const b:any=await req.json();const k=await one('SELECT * FROM classes WHERE id=?',String(b.classId||''));need(k,'课堂不存在',404);need(await one('SELECT 1 FROM enrollments WHERE classId=? AND userId=?',k.id,u.id),'先加入课堂',400);const tid=id();await db.batch([stmt('INSERT INTO teams(id,classId,leader,name,locked,created) VALUES(?,?,?,?,0,?)',tid,k.id,u.id,text(b.name,60),now()),stmt('INSERT INTO members(classId,teamId,userId,slot) VALUES(?,?,?,1)',k.id,tid,u.id)]);return reply({id:tid});}
  if(path==='invite'&&method==='POST'){const b:any=await req.json();const {t,k}=await team(b.teamId,u);need(t.leader===u.id,'仅组长可以邀请新成员');const em=email(b.email);need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em),'邮箱格式无效',400);need(!await one('SELECT 1 FROM invites WHERE teamId=? AND email=? AND status=\'pending\'',t.id,em),'已经有待接受邀请',409);const iv=id();const mail=enqueue(u.id,'email',{to:em,subject:`邀请你加入 ${t.name}`,text:`你收到课序小组 ${t.name} 的邀请。请使用此邮箱注册/登录，加入课堂（邀请码：${k.joinCode}），在“我的 Team”接受邀请。网站：${url.origin}`},k.courseId,k.id,t.id);await db.batch([stmt('INSERT INTO invites VALUES(?,?,?,\'pending\',?)',iv,t.id,em,now()),mail.statement]);return reply({ok:true,message:'邀请已创建；邮件投递状态取决于邮件连接器，也可登录后直接查看。'});}
  if(path==='invite-action'&&method==='POST'){const b:any=await req.json();const iv=await one('SELECT * FROM invites WHERE id=?',b.id);need(iv&&iv.status==='pending','邀请已处理',409);const t=await one('SELECT * FROM teams WHERE id=?',iv.teamId);const k=await one('SELECT * FROM classes WHERE id=?',t.classId);if(b.action==='revoke'){need(t.leader===u.id,'仅组长可以撤销邀请');await run('UPDATE invites SET status=\'revoked\' WHERE id=? AND status=\'pending\'',iv.id);return reply({ok:true});}need(iv.email===u.email,'只能接受发给本人邮箱的邀请');if(b.action==='decline'){await run('UPDATE invites SET status=\'declined\' WHERE id=?',iv.id);return reply({ok:true});}need(b.action==='accept','操作无效',400);const seats=await all('SELECT slot FROM members WHERE teamId=?',t.id);let slot=1;while(seats.some((s:any)=>s.slot===slot))slot++;need(slot<=k.maxSize,'小组已满',409);await db.batch([stmt('INSERT OR IGNORE INTO enrollments VALUES(?,?)',k.id,u.id),stmt('INSERT INTO members SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM invites WHERE id=? AND status=\'pending\')',k.id,t.id,u.id,slot,iv.id),stmt('UPDATE invites SET status=\'accepted\' WHERE id=? AND EXISTS(SELECT 1 FROM members WHERE teamId=? AND userId=?)',iv.id,t.id,u.id)]);return reply({ok:true});}
  if(path==='team-action'&&method==='POST'){const b:any=await req.json();const {t}=await team(b.teamId,u);if(b.action==='transfer'){need(t.leader===u.id,'仅组长可以转让负责人');need(await one('SELECT 1 FROM members WHERE teamId=? AND userId=?',t.id,b.userId),'目标不是组员',400);await run('UPDATE teams SET leader=? WHERE id=?',b.userId,t.id);}else if(b.action==='rename'){need(t.leader===u.id,'仅组长可以修改小组名称');const name=text(b.name,60);need(name,'请输入小组名称',400);await run('UPDATE teams SET name=? WHERE id=?',name,t.id);}else if(b.action==='remove'){need(t.leader===u.id,'仅组长可以移除组员');need(b.userId!==t.leader,'组长请先转让负责人',400);need(await one('SELECT 1 FROM members WHERE teamId=? AND userId=?',t.id,b.userId),'目标不是组员',400);await run('DELETE FROM members WHERE teamId=? AND userId=?',t.id,b.userId);}else if(b.action==='leave'){need(t.leader!==u.id,'组长请先转让负责人',400);await run('DELETE FROM members WHERE teamId=? AND userId=?',t.id,u.id);}else throw Error('未知操作');await record(u.id,'team.'+b.action,t.id,{target:b.userId||u.id}).run();return reply({ok:true});}
  if(path==='team-repo'&&method==='POST'){const b:any=await req.json();const {t}=await team(b.teamId,u);let repo=String(b.repo||'').trim();need(repo===''||/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo),'请输入 GitHub 仓库地址，例如 https://github.com/owner/repo',400);repo=repo.replace(/\/+$/,'');await run('UPDATE teams SET repo=? WHERE id=?',repo,t.id);await record(u.id,'team.repo',t.id,{repo}).run();return reply({ok:true});}
  if(path==='submit'&&method==='POST'){const b:any=await req.json();need(Array.isArray(b.fileIds)&&b.fileIds.length>0&&b.fileIds.length<=20,'请上传作业材料',400);const fs:any[]=[];for(const fid of b.fileIds)fs.push(await accessibleFile(fid,u));const kid=fs[0].classId;need(kid&&fs.every((f:any)=>f.classId===kid),'文件不属于同一课堂',400);const k=await one('SELECT * FROM classes WHERE id=?',kid);need(k,'课堂不存在',404);need(await one('SELECT 1 FROM enrollments WHERE classId=? AND userId=?',kid,u.id),'你不在本课堂中',403);const c=await one('SELECT * FROM courses WHERE id=?',k.courseId);need(c.publishedId,'课程尚未发布',400);const pc=c.primaryClassId?await one('SELECT deadline FROM classes WHERE id=?',c.primaryClassId):null;const dl=pc?pc.deadline:k.deadline;let mk=await one("SELECT * FROM makeups WHERE classId=? AND experimentId IN ('', ?) ORDER BY experimentId='' DESC LIMIT 1",k.id,b.experimentId);
   // 截止时间继承主课堂，补交窗口同样沿用主课堂（本课堂单独设置优先）
   if(!mk&&c.primaryClassId&&c.primaryClassId!==k.id)mk=await one("SELECT * FROM makeups WHERE classId=? AND experimentId IN ('', ?) ORDER BY experimentId='' DESC LIMIT 1",c.primaryClassId,b.experimentId);let makeup=0;if(dl&&now()>dl){need(mk&&now()>=mk.start&&now()<=mk.end,mk?(now()<mk.start?'已超过截止时间，补交尚未开始':'已超过截止时间，补交已结束'):'已超过截止时间',400);makeup=1;}const r=await one('SELECT * FROM releases WHERE id=?',c.publishedId);const exp=parse(r.content).experiments.find((e:any)=>e.id===b.experimentId);need(exp,'实验不存在',400);need(exp.grading!=='none','该实验无需提交，不计成绩',400);need(exp.grading!=='repo','该实验由平台每日巡检评分，无需提交',400);const individual=exp.grading==='individual';let t:any=null,mem:any[];
   if(individual){for(const f of fs)need(f.owner===u.id,'文件不属于本人',403);mem=[{id:u.id,name:u.name,email:u.email}];}
   else{t=await one('SELECT teams.* FROM teams JOIN members ON teams.id=members.teamId WHERE members.userId=? AND members.classId=?',u.id,k.id);need(t,'请先加入本课堂的小组',400);need(t.leader===u.id,'由组长代表小组提交');for(const f of fs)need(f.teamId===t.id,'文件不属于本组',403);mem=await all('SELECT users.id,users.name,users.email FROM members JOIN users ON members.userId=users.id WHERE members.teamId=?',t.id);}
   const ownerCol=individual?'studentId':'teamId';const ownerVal=individual?u.id:t.id;const last=await one(`SELECT MAX(ordinal) as n FROM submissions WHERE ${ownerCol}=? AND experimentId=? AND mode<>'scan'`,ownerVal,exp.id);const ordinal=(last?.n||0)+1;need(ordinal<=3,'每个实验最多提交 3 次（补交计入这 3 次）',409);const mkd=makeup?(mk?.discount||0):0;const sid=id();const note=String(b.note||'').slice(0,20000);
   const siteUrl=normalizeSiteUrl(b.siteUrl)||pickSiteUrl(note);
   const job=enqueue(u.id,'grade',{submissionId:sid,releaseId:r.id,revision:r.revision,part:'web',experiment:scoringExperiment(exp,'web'),fileIds:b.fileIds,note,members:mem,discount:mkd,siteUrl},k.courseId,k.id,t?.id||null);
   const stmts=[job.statement,stmt('INSERT INTO submissions(id,classId,teamId,studentId,experimentId,releaseId,mode,ordinal,members,fileIds,note,makeup,siteUrl,jobId,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sid,k.id,t?.id||null,individual?u.id:null,exp.id,r.id,'formal',ordinal,json(mem),json(b.fileIds),note,mkd,siteUrl,job.id,now())];
   if((exp.reportRubric||[]).length){
    const rids=fs.filter((f:any)=>REPORT_FILE_RE.test(f.name)).map((f:any)=>f.id);
    const rjob=enqueue(u.id,'grade',{submissionId:sid,releaseId:r.id,revision:r.revision,part:'report',experiment:scoringExperiment(exp,'report'),fileIds:rids,note:'[实验报告评分] 只依据提交的实验报告文档评分，不读取网页源码、不检查线上页面。',members:mem,discount:0},k.courseId,k.id,t?.id||null);
    stmts.push(rjob.statement);
   }
   await db.batch(stmts);return reply({id:sid,makeup:!!makeup,discount:mkd});}
  if(path==='appeal'&&method==='POST'){const b:any=await req.json();const s=await one('SELECT * FROM submissions WHERE id=?',b.submissionId);need(s,'提交不存在',404);if(s.teamId)await team(s.teamId,u);else need(s.studentId===u.id);const g=await one('SELECT * FROM grades WHERE submissionId=?',s.id);need(g&&(g.published||s.mode==='practice'),'评分尚未发布',400);await run('INSERT INTO appeals(id,submissionId,userId,content,created) VALUES(?,?,?,?,?)',id(),s.id,u.id,text(b.content),now());return reply({ok:true});}
  if(path==='grade-retry'&&method==='POST'){const b:any=await req.json();const s0=await one('SELECT * FROM submissions WHERE id=?',b.submissionId);need(s0,'提交不存在',404);const k0=await one('SELECT * FROM classes WHERE id=?',s0.classId);need(k0.owner===u.id||u.role==='admin','只有课堂教师可以重新评估',403);need(!await one("SELECT 1 FROM jobs WHERE id=? AND status IN ('queued','running')",s0.jobId),'该提交正在评分中，请等待完成',409);
   const c0=await one('SELECT * FROM courses WHERE id=?',k0.courseId);const r0=await one('SELECT * FROM releases WHERE id=?',c0?.publishedId||s0.releaseId)||await one('SELECT * FROM releases WHERE id=?',s0.releaseId);need(r0,'课程版本不存在',404);const exp0=parse(r0.content).experiments.find((e:any)=>e.id===s0.experimentId);need(exp0,'实验不存在',400);
   const part=b.part==='report'?'report':'web';const fids=parse(s0.fileIds,[]);
   const job=enqueue(u.id,'grade',{submissionId:s0.id,releaseId:r0.id,revision:r0.revision,part,experiment:scoringExperiment(exp0,part),fileIds:part==='report'?await reportFileIds(fids):fids,note:part==='report'?'[实验报告评分] 只依据提交的实验报告文档评分，不读取网页源码、不检查线上页面。':s0.note,members:parse(s0.members,[]),discount:part==='report'?0:(s0.makeup||0),siteUrl:part==='report'?'':(normalizeSiteUrl(s0.siteUrl)||pickSiteUrl(s0.note))},k0.courseId,s0.classId,s0.teamId);await db.batch([job.statement,stmt('UPDATE submissions SET jobId=? WHERE id=?',job.id,s0.id)]);
   return reply({jobId:job.id});}
  // 一键重试：把本课堂所有评分失败的作业批量重新提交评分（教师/管理员）
  if(path==='grade-retry-all'&&method==='POST'){const b:any=await req.json();const k0=await one('SELECT * FROM classes WHERE id=?',b.classId);need(k0,'课堂不存在',404);need(k0.owner===u.id||u.role==='admin','只有课堂教师可以批量重评',403);
   const failed=await all('SELECT s.id AS sid,s.releaseId,s.experimentId,s.fileIds,s.note,s.members,s.teamId,s.makeup,j.payload AS jpayload FROM submissions s JOIN jobs j ON j.id=s.jobId WHERE s.classId=? AND j.status=\'failed\'',k0.id);
   const stmts=[];let count=0;
   for(const s0 of failed){const r0=await one('SELECT * FROM releases WHERE id=?',s0.releaseId);if(!r0)continue;const exp0=parse(r0.content).experiments.find((e:any)=>e.id===s0.experimentId);if(!exp0)continue;
    const p0=parse(s0.jpayload,{});const part=p0.part==='report'?'report':'web';const fids=parse(s0.fileIds,[]);
    const job=enqueue(u.id,'grade',{submissionId:s0.sid,releaseId:r0.id,revision:r0.revision,part,experiment:scoringExperiment(exp0,part),fileIds:part==='report'?await reportFileIds(fids):fids,note:part==='report'?'[实验报告评分] 只依据提交的实验报告文档评分，不读取网页源码、不检查线上页面。':s0.note,members:parse(s0.members,[]),discount:part==='report'?0:(s0.makeup||0)},k0.courseId,k0.id,s0.teamId);
    stmts.push(job.statement,stmt('UPDATE submissions SET jobId=? WHERE id=?',job.id,s0.sid));count++;}
   if(stmts.length)await db.batch(stmts);
   return reply({ok:true,count});}
  if(path==='grade-action'&&method==='POST'){const b:any=await req.json();const s=await one('SELECT * FROM submissions WHERE id=?',b.submissionId);need(s,'提交不存在',404);const k=await one('SELECT * FROM classes WHERE id=?',s.classId);need(k.owner===u.id||u.role==='admin');const g=await one('SELECT * FROM grades WHERE submissionId=?',s.id);need(g,'尚无评分',400);let report=parse(g.report);const reason=text(b.reason);if(b.report){const r=await one('SELECT * FROM releases WHERE id=?',s.releaseId);const e=parse(r.content).experiments.find((e:any)=>e.id===s.experimentId);report=validateAssessment(b.report,e,false);}const mutations=[stmt('UPDATE grades SET report=?,published=1,updated=? WHERE submissionId=?',json(report),now(),s.id),record(u.id,'grade.review',s.id,{reason,before:parse(g.report),after:report})];if(b.appealId)mutations.push(stmt('UPDATE appeals SET status=\'resolved\',resolution=? WHERE id=? AND submissionId=?',reason,b.appealId,s.id));await db.batch(mutations);return reply({ok:true});}
  if(path==='job-action'&&method==='POST'){const b:any=await req.json();const j=await one('SELECT * FROM jobs WHERE id=?',b.id);need(j,'任务不存在',404);need(j.owner===u.id||u.role==='admin'||(j.classId&&await one('SELECT 1 FROM classes WHERE id=? AND owner=?',j.classId,u.id)));need(j.kind!=='email','邮件由系统管理');if(b.action==='cancel')await run('UPDATE jobs SET status=\'cancelled\',finished=? WHERE id=? AND status IN (\'queued\',\'running\')',now(),j.id);else {need(j.status==='failed','只能重试失败任务',409);if(j.kind==='draft'){const p=parse(j.payload);const c=await one('SELECT * FROM courses WHERE id=?',j.courseId);need(p.revision===c.revision,'草案已变更，请发送新消息',409);}await run('UPDATE jobs SET status=\'queued\',lease=NULL,error=NULL,finished=NULL WHERE id=?',j.id);}return reply({ok:true});}
  return reply({error:'接口不存在'},404);
 }catch(e:any){const constraint=/UNIQUE constraint|constraint failed/i.test(e.message);return reply({error:constraint?'操作与当前状态冲突：你可能已加入小组、座位已占用或该版本已提交。请刷新后重试。':e.message||'服务异常'},e.status||(constraint?409:400));}
}
