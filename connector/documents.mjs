// 学生附件正文提取：docx/pdf 提取纯文本，zip 解压到工作目录，其余交给 read 工具直接读取。
// 返回值统一为对象，避免调用方把提取结果丢掉（issue #1：docx/pdf 提取到的正文曾被丢弃，
// 模型只能读到 OOXML/deflate 二进制流，于是静默给 0/60 分）：
//   {mode:'extracted', text} 正文已提取，由 runner 落盘成 *.extracted.md 供 read 工具查看
//   {mode:'inline', text}    text 可直接拼进 prompt（zip 解压清单等）
//   {mode:'raw', note?}      未提取正文，模型读取原始文件；note 为给模型的提示
import fs from 'node:fs/promises';
import path from 'node:path';
import {unzipSync} from 'fflate';
import mammoth from 'mammoth';

const MAX_TEXT_LENGTH=250000;
const MAX_ZIP_FILES=400;
const MAX_ZIP_ENTRY_BYTES=10*1024*1024;
const MAX_ZIP_TOTAL_BYTES=60*1024*1024;
const UNSAFE_NOTE='此附件保留原文件；若 Agent 无法核验该媒体，请明确报告未验证，不得根据文件名猜测内容。';
const PLAIN_TEXT_EXTENSIONS=new Set(['.md','.markdown','.txt','.py','.json','.jsonl','.csv','.ts','.js','.mjs','.html','.htm','.css','.java','.c','.h','.cpp','.cs','.go','.rs','.sql','.xml','.yml','.yaml','.sh','.ipynb']);

// ZIP 文件名解码：Windows 下中文压缩包常用 GBK 且不置 UTF-8 标志位，fflate 一律按 UTF-8 解，
// 结果是一串乱码（或含 U+FFFD），导致解压出来的文件名与评分点对不上。
// 这里按中央目录顺序取原始文件名字节：先严格按 UTF-8 解，失败再退回 GBK。
const strictUtf8=new TextDecoder('utf-8',{fatal:true});
let gbkDecoder=null;
try{gbkDecoder=new TextDecoder('gbk');}catch{}
export function decodeZipName(raw){
 if(!raw||!raw.length)return '';
 try{return strictUtf8.decode(raw);}catch{}
 if(gbkDecoder){try{const s=gbkDecoder.decode(raw);if(s)return s;}catch{}}
 return new TextDecoder().decode(raw);
}
// 读取中央目录里每个条目的原始文件名字节，顺序与 unzipSync 遍历顺序一致；
// 遇到 ZIP64/异常结构返回 null，调用方回退到 fflate 解出的名字。
export function zipRawNames(bytes){
 const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(u8.length<22)return null;
 const view=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
 let eocd=-1;
 for(let i=u8.length-22;i>=0&&u8.length-i<=65558;i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
 if(eocd<0)return null;
 const count=view.getUint16(eocd+10,true);
 let offset=view.getUint32(eocd+16,true);
 const names=[];
 for(let n=0;n<count;n++){
  if(offset+46>u8.length||view.getUint32(offset,true)!==0x02014b50)return null;
  const nameLength=view.getUint16(offset+28,true);
  const extraLength=view.getUint16(offset+30,true);
  const commentLength=view.getUint16(offset+32,true);
  if(offset+46+nameLength>u8.length)return null;
  names.push(u8.subarray(offset+46,offset+46+nameLength));
  offset+=46+nameLength+extraLength+commentLength;
 }
 return names;
}
// 统一分隔符（Windows 打包的 zip 常用反斜杠，不应因此拒绝整份作业）并去掉控制字符。
function normalizeEntryName(name){
 return String(name).replace(/\\/g,'/').replaceAll('\u0000','').replace(/^\.\//,'');
}
function isUnsafeEntry(name){
 if(!name||name.startsWith('/'))return true;
 if(/^[a-zA-Z]:/.test(name))return true;
 return name.split('/').includes('..');
}
// 把 fflate 解出的条目名换成解码后的名字（数量对不上时保留 fflate 的原名）
function zipEntryNames(entries,bytes){
 const keys=Object.keys(entries);
 const raw=zipRawNames(bytes);
 const decoded=raw&&raw.length===keys.length?raw.map(decodeZipName):null;
 return keys.map((k,i)=>normalizeEntryName(decoded?decoded[i]:k));
}
export async function extractDocument(filename,bytes,root){
 const ext=path.extname(filename).toLowerCase();
 if(ext==='.docx'){
  let value;
  try{value=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;}
  catch(e){throw Error('DOCX 无法解析（文件可能已损坏或不是标准 Word 文档）：'+String(e?.message||e).slice(0,200));}
  const text=String(value||'').trim();
  if(!text)return {mode:'inline',text:'（DOCX 未提取到任何文本：文档可能为空，或正文全部是图片）'};
  return {mode:'extracted',text:text.slice(0,MAX_TEXT_LENGTH)};
 }
 if(ext==='.pdf'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let pdf;
  try{pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false}).promise;}
  catch(e){throw Error('PDF 无法解析（文件可能已损坏或加密）：'+String(e?.message||e).slice(0,200));}
  try{
   if(pdf.numPages>100)throw Error('PDF 超过 100 页，请拆分后再提交');
   let text='';
   for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();text+=`\n[第 ${n} 页]\n`+content.items.map(i=>i.str||'').join(' ');if(text.length>MAX_TEXT_LENGTH)throw Error('PDF 文本过长（超过 25 万字符），请拆分后再提交');}
   const plain=text.replace(/\[第 \d+ 页\]/g,'').trim();
   if(plain.length<Math.max(30,pdf.numPages*10))throw Error('扫描版 PDF 没有可提取的文本层（共 '+pdf.numPages+' 页），请改交可复制文本的 PDF、DOCX 或 Markdown');
   return {mode:'extracted',text};
  }finally{await pdf.destroy();}
 }
 if(ext==='.zip'){
  const u8=new Uint8Array(bytes);
  let entries;
  try{
   let total=0,count=0;
   entries=unzipSync(u8,{filter:f=>{if(++count>MAX_ZIP_FILES||f.originalSize>MAX_ZIP_ENTRY_BYTES||(total+=f.originalSize)>MAX_ZIP_TOTAL_BYTES)throw Error(`压缩包解压超过限制（最多 ${MAX_ZIP_FILES} 个文件、单文件 10 MB、总计 60 MB），已处理 ${count-1} 个文件时中断`);return true;}});
  }catch(e){throw Error(/超过限制/.test(String(e?.message))?e.message:'压缩包无法解压：'+String(e?.message||e).slice(0,200));}
  const keys=Object.keys(entries);
  const names=zipEntryNames(entries,u8);
  // 不安全路径一次性收集全部命中的文件名，写进错误里便于教师排查误伤（issue #1：16 个任务因此无成绩）
  const unsafe=names.filter(isUnsafeEntry);
  if(unsafe.length)throw Error('压缩包包含不安全路径（绝对路径、盘符或 .. 越级）：'+unsafe.slice(0,10).join('、')+(unsafe.length>10?` 等 ${unsafe.length} 个文件`:''));
  const out=path.resolve(root,'extracted');
  await fs.mkdir(out,{recursive:true});
  const written=[];
  const nested=[];
  for(let i=0;i<keys.length;i++){
   const name=names[i];
   if(!name||name.endsWith('/'))continue;
   const target=path.resolve(out,name);
   if(!target.startsWith(out+path.sep))throw Error('压缩包路径越界：'+name);
   await fs.mkdir(path.dirname(target),{recursive:true});
   await fs.writeFile(target,entries[keys[i]]);
   written.push(name);
   if(/\.(docx|pdf)$/i.test(name))nested.push({name,target,data:entries[keys[i]]});
  }
  // 压缩包里再套 docx/pdf 时同样提取正文，否则模型拿到的仍是二进制（issue #1 中 19 份 zip 就属此类）
  const notes=[];
  for(const item of nested){
   try{
    const sub=await extractDocument(path.basename(item.target),item.data,path.dirname(item.target));
    if(sub.mode==='extracted'){const extractedPath=item.target+'.extracted.md';await fs.writeFile(extractedPath,sub.text);notes.push(`${item.name} → 提取正文 ${extractedPath}`);}
    else if(sub.mode==='inline')notes.push(`${item.name} → ${sub.text}`);
   }catch(e){notes.push(`${item.name} → 提取失败：${String(e?.message||e).slice(0,200)}`);}
  }
  return {mode:'inline',text:`作业已解压到 ${out}，共 ${written.length} 个文件：\n`+written.join('\n')+(notes.length?'\n\n内嵌文档的提取结果：\n'+notes.join('\n'):'')};
 }
 if(PLAIN_TEXT_EXTENSIONS.has(ext))return {mode:'raw'};
 if(ext==='.doc')return {mode:'raw',note:'旧版 .doc 二进制格式无法提取文本，请让教师/学生另存为 .docx、PDF 或 Markdown 后再评。'};
 return {mode:'raw',note:UNSAFE_NOTE};
}
