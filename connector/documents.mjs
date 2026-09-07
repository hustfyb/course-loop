import fs from 'node:fs/promises';
import path from 'node:path';
import {unzipSync} from 'fflate';
import mammoth from 'mammoth';
export async function extractDocument(filename,bytes,root){
 const ext=path.extname(filename).toLowerCase();
 if(ext==='.docx'){const r=await mammoth.extractRawText({buffer:Buffer.from(bytes)});return r.value.slice(0,250000);}
 if(ext==='.pdf'){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false}).promise;try{if(pdf.numPages>100)throw Error('PDF 超过 100 页，请拆分');let text='';for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const c=await p.getTextContent();text+=`\n[第 ${n} 页]\n`+c.items.map(i=>i.str||'').join(' ');if(text.length>250000)throw Error('PDF 文本过长，请拆分');}if(text.trim().length<pdf.numPages*15)throw Error('扫描 PDF 没有足够文本，请上传可复制文本的 PDF、DOCX 或 Markdown');return text;}finally{await pdf.destroy();}}
 if(ext==='.zip'){let total=0,count=0;const entries=unzipSync(new Uint8Array(bytes),{filter:f=>{if(++count>400||f.originalSize>10*1024*1024||(total+=f.originalSize)>60*1024*1024)throw Error('压缩包解压大小或文件数超过限制');return true;}});const out=path.resolve(root,'extracted');await fs.mkdir(out,{recursive:true});for(const [name,data] of Object.entries(entries)){if(name.endsWith('/'))continue;if(name.includes('\\')||name.includes(':')||name.split('/').includes('..')||name.startsWith('/'))throw Error('压缩包包含不安全路径');const target=path.resolve(out,name);if(!target.startsWith(out+path.sep))throw Error('压缩包路径越界');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);}return '作业已解压到 '+out+'。文件：\n'+Object.keys(entries).join('\n');}
 if(['.md','.txt','.py','.json','.jsonl','.csv'].includes(ext))return new TextDecoder().decode(bytes).slice(0,250000);
 return '此附件保留原文件；若 Agent 无法核验该媒体，请明确报告未验证，不得根据文件名猜测内容。';
}
