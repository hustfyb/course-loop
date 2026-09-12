// Non-browser verification against the real local Worker/D1/R2 runtime.
import assert from 'node:assert/strict';
const base=process.env.TEST_SITE||'http://localhost:3000';let cookie='';
const code=process.env.DEV_EMAIL_CODE||'482916';
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return data;}
await api('health');
await api('auth/request',{email:'hustfyb@gmail.com'});
await api('auth/verify',{email:'hustfyb@gmail.com',code});
let s=await api('state');assert.equal(s.user.role,'admin');if(!s.courses.length){await api('courses',{term:'2026 秋季学期'});s=await api('state');}
assert.equal(s.draft.experiments.length,4);assert.equal(s.courses[0].joinCode,undefined);assert.equal(s.courses[0].maxSize,undefined);
// Teacher opens a class on the admin's course; student joins with the class join code.
await api('auth/request',{email:'teacher@example.com'});
await api('auth/verify',{email:'teacher@example.com',code});
let me=await api('state');if(me.user.role==='pending')await api('auth/profile',{role:'teacher',name:'示例教师'});
let ts=await api('state');assert.equal(ts.user.role,'teacher');assert.equal(ts.courses.length>=1,true);
if(!ts.classes.length){await api('classes',{courseId:ts.courses[0].id,name:'冒烟课堂'});ts=await api('state');}
assert.match(ts.classes[0].joinCode,/^[A-Z0-9]{10}$/);assert.equal(ts.classes[0].courseTitle,s.courses[0].title);
await api('auth/request',{email:'student@example.com'});
await api('auth/verify',{email:'student@example.com',code});
me=await api('state');if(me.user.role==='pending')await api('auth/profile',{role:'student',name:'示例学生',studentNo:'2026001'});
const joined=await api('join',{code:ts.classes[0].joinCode});assert.equal(joined.id,ts.classes[0].id);
const ss=await api('state');assert.equal(ss.classes[0].joinCode,undefined);assert.equal(ss.classes[0].teacherName,'示例教师');
const root=await fetch(base);assert.equal(root.status,200);const materials=await fetch(base+'/materials/rpg-baseline.zip');assert.equal(materials.status,200);
console.log('Live Worker smoke passed: admin course, teacher class + join code, student enrollment, page and material download. No real mail or model calls.');
