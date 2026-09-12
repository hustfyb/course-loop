// 组队实测续段：复用已建好的两队，验证教师视角与练习提交
import assert from 'node:assert/strict';
const base = 'http://localhost:7100';
const CODE = '482916';
const jars = new Map();
async function api(as, path, body) {
  const r = await fetch(base + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), cookie: jars.get(as) || '' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie');
  if (sc) jars.set(as, sc.split(';')[0]);
  const ct = r.headers.get('content-type');
  return { status: r.status, data: ct?.includes('json') ? await r.json() : await r.arrayBuffer() };
}
async function login(email) {
  assert.equal((await api(email, 'auth/request', { email })).status, 200);
  const v = await api(email, 'auth/verify', { email, code: CODE });
  assert.equal(v.status, 200, email + ': ' + JSON.stringify(v.data));
}
const A = 'stu-a@example.com', T = 'teacher1@example.com', AD = 'hustfyb@gmail.com';
await login(A); await login(T); await login(AD);
const stA = (await api(A, 'state')).data;
const kid = stA.selected;
const rocket = stA.teams.find((t) => t.name === '火箭队');
assert.ok(rocket, '应找到火箭队');
// 课程未发布则先由管理员发布
const cid = stA.course?.id;
const stAdm = (await api(AD, 'state?course=' + cid)).data;
if (!stAdm.release) {
  const pub = await api(AD, 'publish', { courseId: cid, revision: 1 });
  assert.equal(pub.status, 200, 'publish: ' + JSON.stringify(pub.data));
  console.log('  ✔ 管理员发布课程 v1');
}
const stT = (await api(T, 'state?class=' + kid)).data;
assert.equal(stT.students.length, 5, '教师应看到 5 名学生');
assert.equal(stT.teams.length, 2, '教师应看到 2 个 Team');
assert.deepEqual(stT.teams.find((t) => t.name === '火箭队').members.map((m) => m.name).sort(), ['林二', '陈一']);
assert.deepEqual(stT.teams.find((t) => t.name === '探索队').members.map((m) => m.name).sort(), ['周四', '苏三']);
console.log('  ✔ 教师视角：5 名学生 · 2 个 Team，成员名单正确');
const fd = new FormData();
fd.set('classId', kid); fd.set('teamId', rocket.id);
fd.set('file', new File(['# spec\n背包排序验收标准…'], 'spec.md'));
const up = await api(A, 'upload', fd);
assert.equal(up.status, 200, JSON.stringify(up.data));
const sub = await api(A, 'submit', { teamId: rocket.id, experimentId: 'exp-1', mode: 'practice', fileIds: [up.data.id], note: '第一次练习' });
assert.equal(sub.status, 200, JSON.stringify(sub.data));
const mine = (await api(A, 'state?class=' + kid)).data.submissions.find((s) => s.id === sub.data.id);
assert.ok(mine && ['queued', 'running', 'complete'].includes(mine.status));
console.log('  ✔ 练习提交成功，核验任务已进入队列(' + mine.status + ')');
const teacherView = (await api(T, 'state?class=' + kid)).data.submissions.find((s) => s.id === sub.data.id);
assert.ok(teacherView && teacherView.teamName === '火箭队');
console.log('  ✔ 教师能看到火箭队的练习提交');
console.log('\n教师视角与提交链路实测通过 ✅');
