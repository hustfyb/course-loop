// Test-only ACP peer. Never configured by the production connector.
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin});const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
rl.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(m.method==='session/new')send({jsonrpc:'2.0',id:m.id,result:{sessionId:'fixture-session'}});else if(m.method==='session/prompt'){send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'{"fixture":true}'}}}});send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}});}});
