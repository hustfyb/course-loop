// 故障 ACP 对端（仅测试用）：模拟 Pi 未配置 provider 的配置错误。
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin});const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
rl.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(m.method==='session/new')send({jsonrpc:'2.0',id:m.id,result:{sessionId:'broken-session'}});else if(m.method==='session/prompt')send({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'Pi 未配置 provider：请先在 Pi 配置中设置模型提供方后重试'}});});
