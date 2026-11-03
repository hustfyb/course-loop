import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import {crc32} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {zipSync,strToU8} from 'fflate';
import {AcpClient} from '../acp.mjs';
import {extractDocument,decodeZipName,zipRawNames} from '../documents.mjs';
import {startRunner} from '../runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));

// 手写 stored（不压缩）ZIP：fflate 的 zipSync 只能写 UTF-8 文件名，GBK 文件名需要原始字节。
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}
function storedZip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const {nameBytes,data} of entries){
  const body=Buffer.from(data),name=Buffer.from(nameBytes),crc=crc32(body);
  const local=Buffer.concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(body.length),u32(body.length),u16(name.length),u16(0),name,body]);
  centrals.push(Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(body.length),u32(body.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
  locals.push(local);offset+=local.length;
 }
 const cd=Buffer.concat(centrals);
 const eocd=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cd.length),u32(offset),u16(0)]);
 return new Uint8Array(Buffer.concat([...locals,cd,eocd]));
}
function docxBytes(text){
 return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>')});
}
const tempDir=()=>fs.mkdtemp(path.join(os.tmpdir(),'course-connector-test-'));
const cleanup=async dir=>{try{await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{}};

test('ACP initialization, new session, streamed output and termination',async()=>{const client=new AcpClient(process.execPath,[path.join(here,'fixture-acp.mjs')],{cwd:here,timeout:5000});try{const result=await client.run(here,'fixture');assert.deepEqual(JSON.parse(result),{fixture:true});assert.equal(client.sessionId,'fixture-session')}finally{client.close()}});

test('ZIP 解压：正常项目展开到 extracted，清单交给模型',async()=>{
 const dir=await tempDir();
 try{
  const good=zipSync({'src/main.py':strToU8('print(1)'),'docs/readme.md':strToU8('# hi')});
  const r=await extractDocument('project.zip',good,dir);
  assert.equal(r.mode,'inline');
  assert.match(r.text,/src\/main\.py/);
  assert.match(r.text,/docs\/readme\.md/);
  assert.equal(await fs.readFile(path.join(dir,'extracted/src/main.py'),'utf8'),'print(1)');
 }finally{await cleanup(dir)}
});

test('ZIP 解压：不安全路径拒绝并把命中的文件名写进错误',async()=>{
 const dir=await tempDir();
 try{
  const bad=zipSync({'../escape.txt':strToU8('unsafe'),'ok.txt':strToU8('fine')});
  await assert.rejects(()=>extractDocument('bad.zip',bad,dir),(e)=>/不安全路径/.test(e.message)&&/\.\.\/escape\.txt/.test(e.message));
 }finally{await cleanup(dir)}
});

test('ZIP 解压：反斜杠分隔的 Windows 路径不再误判为不安全',async()=>{
 const dir=await tempDir();
 try{
  const bytes=storedZip([{nameBytes:Buffer.from('src\\main.py'),data:Buffer.from('print(2)')}]);
  const r=await extractDocument('win.zip',bytes,dir);
  assert.equal(r.mode,'inline');
  assert.equal(await fs.readFile(path.join(dir,'extracted/src/main.py'),'utf8'),'print(2)');
 }finally{await cleanup(dir)}
});

test('ZIP 解压：GBK 编码的中文文件名按 GBK 回退解码',async()=>{
 const dir=await tempDir();
 try{
  // “中文报告.txt” 的 GBK 字节（Windows 中文压缩包常见形态，且不置 UTF-8 标志位）
  const gbkName=Buffer.concat([Buffer.from('d6d0cec4b1a8b8e6','hex'),Buffer.from('.txt')]);
  assert.equal(new TextDecoder('gbk').decode(gbkName),'中文报告.txt');
  const bytes=storedZip([{nameBytes:gbkName,data:Buffer.from('实验报告正文')}]);
  const raw=zipRawNames(bytes);
  assert.equal(decodeZipName(raw[0]),'中文报告.txt');
  const r=await extractDocument('gbk.zip',bytes,dir);
  assert.equal(r.mode,'inline');
  assert.match(r.text,/中文报告\.txt/);
  assert.equal(await fs.readFile(path.join(dir,'extracted/中文报告.txt'),'utf8'),'实验报告正文');
 }finally{await cleanup(dir)}
});

test('ZIP 内嵌 docx 也提取正文，模型不必去读二进制',async()=>{
 const dir=await tempDir();
 try{
  const zip=zipSync({'报告.docx':docxBytes('内嵌正文'),'src/a.py':strToU8('print(3)')});
  const r=await extractDocument('sub.zip',zip,dir);
  assert.match(r.text,/内嵌文档的提取结果/);
  assert.match(r.text,/提取正文/);
  assert.equal(await fs.readFile(path.join(dir,'extracted/报告.docx.extracted.md'),'utf8'),'内嵌正文');
 }finally{await cleanup(dir)}
});

test('DOCX 提取正文并标记为 extracted（不再把提取结果丢掉）',async()=>{
 const dir=await tempDir();
 try{
  const r=await extractDocument('course.docx',docxBytes('实验评分标准'),dir);
  assert.equal(r.mode,'extracted');
  assert.match(r.text,/实验评分标准/);
 }finally{await cleanup(dir)}
});

test('未知/旧版格式只保留原文件并给出提示',async()=>{
 const dir=await tempDir();
 try{
  const doc=await extractDocument('old.doc',new Uint8Array([1,2,3]),dir);
  assert.equal(doc.mode,'raw');
  assert.match(doc.note,/\.docx/);
  const txt=await extractDocument('note.md',strToU8('# 标题'),dir);
  assert.equal(txt.mode,'raw');
 }finally{await cleanup(dir)}
});

// 假网站 + 假 Pi：验证 runner 把 docx 提取正文落盘并在 prompt 里给出路径，任务正常回传结果。
async function fakeSite(job,fileBytes){
 const received={finishes:[]};
 const server=http.createServer((req,res)=>{
  const send=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
  const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const url=req.url.split('?')[0];
   if(url.endsWith('/poll'))return send({job:received.finishes.length?null:job});
   if(url.startsWith('/api/connector/file/')){res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(Buffer.from(fileBytes));}
   if(url.startsWith('/api/connector/finish/')){try{received.finishes.push({id:url.split('/').pop(),body:JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')});}catch{received.finishes.push({id:url.split('/').pop(),body:{}});}return send({ok:true});}
   return send({ok:true});
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {baseUrl:'http://127.0.0.1:'+server.address().port,received,close:()=>new Promise(r=>server.close(r))};
}
async function fakePi(dir){
 const file=path.join(dir,'fake-pi-'+Math.random().toString(36).slice(2)+'.mjs');
 await fs.writeFile(file,`import fs from 'node:fs';
fs.writeFileSync('prompt-copy.md',fs.readFileSync('PROMPT.md','utf8'));
const result={items:[{id:'a',score:80,reason:'ok',evidence:['x']}],baseline:true,suggestions:[],needsReview:false,limitations:[]};
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(result)}]}})+'\\n');
`);
 return {command:process.execPath,args:[file],shell:false};
}

test('runner：docx 附件的提取正文落盘为 .extracted.md 并写进 prompt',async()=>{
 const dir=await tempDir();
 const site=await fakeSite({id:'job1',kind:'grade',lease:'lease1',payload:{title:'实验1',rubric:[{id:'a',max:100}]},files:[{id:'f1',name:'实验报告.docx'}]},docxBytes('模型只能读到这段正文'));
 try{
  const runner=startRunner({baseUrl:site.baseUrl,token:'t',workRoot:path.join(dir,'work'),acp:await fakePi(dir),pollIntervalMs:50,taskTimeoutMs:20000,idleTimeoutMs:10000,log:()=>{},errorLog:()=>{}});
  const deadline=Date.now()+15000;
  while(!site.received.finishes.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  runner.stop();
  await runner.done;
  assert.equal(site.received.finishes.length,1,'任务应回传结果');
  const work=path.join(dir,'work','job1-lease1');
  const prompt=await fs.readFile(path.join(work,'prompt-copy.md'),'utf8');
  assert.match(prompt,/实验报告\.docx\.extracted\.md/,'prompt 应给出提取正文的路径');
  assert.match(prompt,/不要直接 read/,'应提示原始 docx 是二进制');
  const extracted=await fs.readFile(path.join(work,'f1','实验报告.docx.extracted.md'),'utf8');
  assert.match(extracted,/模型只能读到这段正文/);
  assert.equal(site.received.finishes[0].body.result.items[0].score,80);
 }finally{await site.close();await cleanup(dir)}
});

test('runner：提取失败（压缩包超限）不炸任务，提示模型按可读材料评分并 needsReview',async()=>{
 const dir=await tempDir();
 const many={};for(let i=0;i<410;i++)many['f'+i+'.txt']=strToU8('x');
 const site=await fakeSite({id:'job2',kind:'grade',lease:'lease2',payload:{title:'实验2',rubric:[{id:'a',max:100}]},files:[{id:'f1',name:'big.zip'}]},zipSync(many));
 try{
  const runner=startRunner({baseUrl:site.baseUrl,token:'t',workRoot:path.join(dir,'work'),acp:await fakePi(dir),pollIntervalMs:50,taskTimeoutMs:20000,idleTimeoutMs:10000,log:()=>{},errorLog:()=>{}});
  const deadline=Date.now()+15000;
  while(!site.received.finishes.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  runner.stop();
  await runner.done;
  assert.equal(site.received.finishes.length,1);
  const prompt=await fs.readFile(path.join(dir,'work','job2-lease2','prompt-copy.md'),'utf8');
  assert.match(prompt,/自动提取失败/);
  assert.match(prompt,/超过限制/);
  assert.match(prompt,/needsReview 设为 true/);
  assert.ok(site.received.finishes[0].body.result,'提取失败也应正常回传评分结果');
 }finally{await site.close();await cleanup(dir)}
});
