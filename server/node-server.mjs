// 课序自托管服务器（Node 主运行时）。
// 复用 lib/service.ts 的运行时无关 api(req, env)：node:sqlite 做 D1 兼容封装、本地目录做 FILES、
// 进程内扫描并直连 Pi（print 单发模式），SMTP 经 nodemailer 直发。启动：npm run build && npm run serve。
import http from 'node:http';
import fs from 'node:fs/promises';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import nodemailer from 'nodemailer';
import {runPiPrint} from '../connector/pi-print.mjs';
import {startRunner,agentIdentity} from '../connector/runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const execFileAsync=promisify(execFile);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const CONTENT_TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.map':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.mp4':'video/mp4','.zip':'application/zip','.webmanifest':'application/manifest+json'};
const sha256hex=(s)=>crypto.createHash('sha256').update(s).digest('hex');
// D1 兼容封装：prepare→bind/first/all/run + batch 事务（与 tests/service.test.mjs 的 wrapper 同语义）。
export function wrapD1(sqlite){const wrapper=(sql,params=[])=>({bind(...v){return wrapper(sql,v)},async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:r.changes}}}});return {prepare:wrapper,async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e}}};}
export function createDb(dataDir){mkdirSync(dataDir,{recursive:true});const sqlite=new DatabaseSync(path.join(dataDir,'course-loop.sqlite'));sqlite.exec('PRAGMA foreign_keys=ON');return sqlite;}
// 幂等迁移：__migrations 记录已执行文件，按文件名顺序补执行 drizzle/*.sql。
export async function migrate(sqlite,drizzleDir){sqlite.exec('CREATE TABLE IF NOT EXISTS __migrations(name TEXT PRIMARY KEY)');const done=new Set(sqlite.prepare('SELECT name FROM __migrations').all().map(r=>r.name));for(const f of (await fs.readdir(drizzleDir)).filter(f=>f.endsWith('.sql')).sort()){if(done.has(f))continue;sqlite.exec('BEGIN');try{sqlite.exec(await fs.readFile(path.join(drizzleDir,f),'utf8'));sqlite.prepare('INSERT INTO __migrations VALUES(?)').run(f);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e}}}
// FILES 本地目录实现：key 为 UUID，无路径风险。
export function localFiles(dir){mkdirSync(dir,{recursive:true});return {async put(key,bytes){await fs.writeFile(path.join(dir,key),Buffer.from(bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes))},async get(key){try{return {body:await fs.readFile(path.join(dir,key))};}catch{return null}},async delete(key){await fs.rm(path.join(dir,key),{force:true})}};}
// 在本机 PATH 中查找 pi；PI_COMMAND 显式指定时跳过扫描。返回 {command,args,shell} 或 null。
export async function findPi({pathEnv=process.env.PATH,explicit}={}){if(explicit)return piSpec(explicit);const cmd=process.platform==='win32'?'where.exe':'which';let out;try{({stdout:out}=await execFileAsync(cmd,['pi'],{env:{...process.env,PATH:pathEnv}}));}catch{return null}const lines=String(out).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length)return null;let chosen=lines[0];if(process.platform==='win32')chosen=lines.find(l=>/\.(cmd|exe|bat)$/i.test(l))||lines[0];return piSpec(chosen);}
function piSpec(command){return {command,args:[],shell:process.platform==='win32'&&/\.(cmd|bat)$/i.test(command)};}
// 探针：用 print 单发模式（--no-tools）向 Pi 提一个最小问题验证配置可用性，返回文本非空即通过；
// 失败时返回截断的错误摘要（provider 未配置等原样保留）。
export async function probePi(spec,{cwd,timeoutMs=60000}={}){try{const r=await runPiPrint(spec,{cwd:cwd||process.cwd(),prompt:'请只回复 ok',timeoutMs,tools:false});return String(r.text||'').trim()?{ok:true}:{ok:false,error:'Pi 探测未返回内容'};}catch(e){return {ok:false,error:String(e?.message||e).slice(0,300)};}}
// lib/service.ts 是 TypeScript：启动时转译到数据目录缓存后 import（与 tests/service.test.mjs 同法）。
export async function loadApi(cacheDir){await fs.mkdir(cacheDir,{recursive:true});for(const name of ['domain','seed','service']){let src=await fs.readFile(path.join(root,'lib',name+'.ts'),'utf8');src=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("'./seed'","'./seed.mjs'").replaceAll("'./domain'","'./domain.mjs'");await fs.writeFile(path.join(cacheDir,name+'.mjs'),src);}return (await import(pathToFileURL(path.join(cacheDir,'service.mjs')).href+'?t='+Date.now())).api;}
export async function startServer({port,host='0.0.0.0',dataDir=path.join(root,'data'),env=process.env,pathEnv,pollIntervalMs=2000,scanIntervalMs=60000,probeTimeoutMs=60000,clientDir=path.join(root,'dist','client'),serverEntry=path.join(root,'dist','server','index.js'),drizzleDir=path.join(root,'drizzle'),log=console.log}={}){
 port=port??Number(env.PORT||7100);
 mkdirSync(dataDir,{recursive:true});
 const sqlite=createDb(dataDir);
 await migrate(sqlite,drizzleDir);
 const filesDir=path.join(dataDir,'files');const workRoot=path.join(dataDir,'agent-work');mkdirSync(workRoot,{recursive:true});
 const api=await loadApi(path.join(dataDir,'.modules'));
 const platform={DB:wrapD1(sqlite),FILES:localFiles(filesDir),ADMIN_EMAILS:env.ADMIN_EMAILS||'',LOCAL_DEV:env.LOCAL_DEV||'',DEV_EMAIL_CODE:env.DEV_EMAIL_CODE||''};
 const readHealth=()=>{const row=sqlite.prepare("SELECT value FROM settings WHERE key='connector_health'").get();return row?JSON.parse(row.value):{};};
 const updateHealth=(patch)=>sqlite.prepare("INSERT INTO settings VALUES('connector_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({...readHealth(),...patch}));
 // 进程内 runner 凭据：启动时生成并覆盖写 settings.connector_token（与 pair 端点同格式；自托管模式下 pair 无意义）。
 const token=crypto.randomUUID()+crypto.randomUUID();
 sqlite.prepare("INSERT INTO settings VALUES('connector_token',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sha256hex(token));
 // SMTP：未配置则不声明 mail 能力，并在 connector_health 写 mailError 提示。
 let sendMail=null;
 if(env.SMTP_HOST){const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||465),secure:String(env.SMTP_SECURE??'true')!=='false',auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS||''}:undefined});const from=env.SMTP_FROM||env.SMTP_USER;sendMail=async(m)=>{await transport.sendMail({from,...m});};updateHealth({mailError:null});}
 else updateHealth({mailError:'未配置 SMTP_HOST，邮件功能离线：登录验证码与邀请邮件不会投递'});
 // Pi 扫描与探测：启动时 + 每 scanIntervalMs。acpAt 只在探测成功时更新；找不到时 acpFound=false 且不写 acpError（界面显示「未连接」）；找到但探测失败才写 acpError。
 // PI_ARGS（可选）：追加到所有 pi 调用的额外参数，如锁定模型 --provider carbit --model qwen38-nvfp4。
 const piArgs=(env.PI_ARGS||'').match(/(?:[^\s"]+|"[^"]*")+/g)?.map(s=>s.replace(/^"|"$/g,''))||[];
 const piState={spec:null,error:null};
 // 使用助手「小课」：pi 可用时以 print 单发（--no-tools）注入 runAssist，工作目录独立于任务目录；
 // piState.spec 随扫描动态变化，getter 保证不可用期间 env.runAssist 为 undefined（端点据此 503 诚实降级）。
 Object.defineProperty(platform,'runAssist',{enumerable:true,get:()=>piState.spec?async(prompt)=>{const dir=path.join(workRoot,'assist',crypto.randomUUID());await fs.mkdir(dir,{recursive:true});const r=await runPiPrint(piState.spec,{cwd:dir,prompt:agentIdentity+'\n\n'+prompt,tools:false,timeoutMs:90000});return r.text;}:undefined});
 async function scan(){const found=await findPi({pathEnv:pathEnv??env.PATH,explicit:env.PI_COMMAND});
  if(!found){piState.spec=null;piState.error='未在本机 PATH 找到 pi，请先安装 Pi（npm install -g @earendil-works/pi-coding-agent）';updateHealth({acpFound:false,acpError:null});return;}
  if(piArgs.length)found.args=[...piArgs,...(found.args||[])];
  const binDir=path.dirname(found.command);if(!process.env.PATH?.split(path.delimiter).includes(binDir))process.env.PATH=binDir+path.delimiter+(process.env.PATH||''); // 同目录依赖（如 node）随 pi 一并可达
  const probe=await probePi(found,{cwd:workRoot,timeoutMs:probeTimeoutMs});
  if(probe.ok){piState.spec=found;piState.error=null;updateHealth({acpFound:true,acpAt:Date.now(),acpError:null});}
  else{piState.spec=null;piState.error=probe.error;updateHealth({acpFound:true,acpError:probe.error});}}
 await scan();
 const scanTimer=scanIntervalMs>0?setInterval(()=>{scan().catch(()=>{})},scanIntervalMs):null;
 scanTimer?.unref?.();
 // 页面渲染回退：dist/client 没有 index.html 时（vinext RSC 构建不产出静态入口），
 // 把非 /api 请求交给构建产物 dist/server/index.js 的默认 fetch 处理；加载失败则仅静态服务。
 let entryFetch=null;
 if(serverEntry&&existsSync(serverEntry)){try{const m=await import(pathToFileURL(serverEntry).href);entryFetch=typeof m.default==='function'?m.default:m.default?.fetch?.bind(m.default)??null;}catch(e){log('提示：构建入口加载失败，页面仅静态服务：'+e.message);}}
 const sendWeb=async(response,res)=>{const out={};response.headers.forEach((v,k)=>{if(k.toLowerCase()!=='set-cookie')out[k]=v;});const cookies=response.headers.getSetCookie?response.headers.getSetCookie():[];if(cookies.length)out['set-cookie']=cookies;const body=Buffer.from(await response.arrayBuffer());out['content-length']=body.length;res.writeHead(response.status,out);res.end(body);};
 const makeRequest=(req,url)=>{const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(v===undefined)continue;const key=k.toLowerCase();if(['host','connection','content-length','transfer-encoding','expect'].includes(key))continue;headers.set(key,Array.isArray(v)?v.join(', '):v);}const hasBody=!['GET','HEAD'].includes(req.method||'GET');return new Request(url.toString(),{method:req.method,headers,...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});};
 // 静态文件命中则服务并返回 true；否则 false。dist/client 缺失时不命中。
 async function tryServeFile(pathname,res){
  if(!existsSync(clientDir))return false;
  let file;try{const safe=path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/,'').replace(/^(\.\.([/\\]|$))+/,'');file=path.join(clientDir,safe);}catch{return false;}
  if(!file.startsWith(clientDir))return false;
  const st=await fs.stat(file).catch(()=>null);
  if(!st||!st.isFile())return false;
  const data=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':CONTENT_TYPES[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-cache'});res.end(data);return true;
 }
 const notBuilt=(res)=>{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('前端尚未构建：请先运行 npm run build 生成 dist/client');};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url||'/','http://'+(req.headers.host||'127.0.0.1'));
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')){await sendWeb(await api(makeRequest(req,url),platform),res);return;}
  if(['GET','HEAD'].includes(req.method||'')&&await tryServeFile(url.pathname,res))return;
  if(!existsSync(clientDir)){notBuilt(res);return;}
  const indexHtml=path.join(clientDir,'index.html');
  if(['GET','HEAD'].includes(req.method||'')&&existsSync(indexHtml)){const data=await fs.readFile(indexHtml);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-cache'});res.end(data);return;}
  if(entryFetch){await sendWeb(await entryFetch(makeRequest(req,url)),res);return;}
  if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405);res.end();return;}
  notBuilt(res);
 }catch(e){if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:String(e?.message||e)}));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const actualPort=server.address().port;
 const runner=startRunner({baseUrl:`http://127.0.0.1:${actualPort}`,token,acp:()=>piState.spec,sendMail,workRoot,pollIntervalMs,log,errorLog:log});
 log(`课序服务器已启动：http://localhost:${actualPort}/`);
 log(`数据目录：${dataDir}`);
 log(`Pi 扫描：${piState.spec?piState.spec.command+'（探测通过）':'未连接'+(piState.error?'：'+piState.error:'')}`);
 log(`SMTP：${sendMail?'已启用（'+env.SMTP_HOST+'）':'未配置，邮件功能离线'}`);
 if(!existsSync(clientDir))log('提示：dist/client 不存在，页面将返回 503；请先运行 npm run build');
 return {port:actualPort,sqlite,token,piState,close:async()=>{runner.stop();if(scanTimer)clearInterval(scanTimer);await Promise.race([runner.done,sleep(pollIntervalMs+10000)]);await new Promise(r=>server.close(r));sqlite.close();}};
}
const isMain=!!process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain){const vars=path.join(root,'.dev.vars');if(existsSync(vars)){try{process.loadEnvFile(vars);}catch(e){console.error('加载 .dev.vars 失败：',e.message);}}const app=await startServer();const shutdown=async()=>{await app.close().catch(()=>{});process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);}
