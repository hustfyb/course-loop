// Non-browser verification against the real local Worker/D1/R2 runtime.
import assert from 'node:assert/strict';
const base=process.env.TEST_SITE||'http://localhost:3000';let cookie='';
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return data;}
await api('health');
await api('auth/request',{email:'hustfyb@gmail.com'});
await api('auth/verify',{email:'hustfyb@gmail.com',code:process.env.DEV_EMAIL_CODE||'482916',name:'课程负责人',studentNo:''});
let s=await api('state');assert.equal(s.user.role,'teacher');if(!s.courses.length){await api('courses',{term:'2026 秋季学期'});s=await api('state');}
assert.equal(s.draft.experiments.length,4);assert.equal(s.courses[0].maxSize,4);
const root=await fetch(base);assert.equal(root.status,200);const materials=await fetch(base+'/materials/rpg-baseline.zip');assert.equal(materials.status,200);
console.log('Live Worker smoke passed: email session, administrator role, persisted four-experiment course, page and material download. No real mail or model calls.');
