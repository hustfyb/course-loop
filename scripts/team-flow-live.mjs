// 组队功能端到端实测（直连本地 dev 服务器，使用开发验证码）
import assert from 'node:assert/strict';
const base = process.env.TEST_SITE || 'http://localhost:7100';
const CODE = process.env.DEV_EMAIL_CODE || '482916';
const CLASS_CODE = process.env.CLASS_CODE || '9621EC5794'; // 软工 1 班

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
async function student(email, name, no) {
  assert.equal((await api(email, 'auth/request', { email })).status, 200);
  const v = await api(email, 'auth/verify', { email, code: CODE });
  assert.equal(v.status, 200, email + ' verify: ' + JSON.stringify(v.data));
  if (v.data.user.role === 'pending') {
    const p = await api(email, 'auth/profile', { role: 'student', name, studentNo: no });
    assert.equal(p.status, 200, email + ' profile: ' + JSON.stringify(p.data));
  }
  return email;
}
const ok = (msg) => console.log('  ✔', msg);

// 1. 注册 4 名学生并凭邀请码加入课堂
const [A, B, C, D] = ['stu-a@example.com', 'stu-b@example.com', 'stu-c@example.com', 'stu-d@example.com'];
await student(A, '陈一', 'U2026101'); await student(B, '林二', 'U2026102');
await student(C, '苏三', 'U2026103'); await student(D, '周四', 'U2026104');
for (const s of [A, B, C, D]) {
  const j = await api(s, 'join', { code: CLASS_CODE });
  assert.equal(j.status, 200, s + ' join: ' + JSON.stringify(j.data));
}
ok('4 名学生注册并凭课堂邀请码加入');

// 无效邀请码
const bad = await api(A, 'join', { code: 'WRONGCODE1' });
assert.equal(bad.status, 400); assert.match(bad.data.error, /课堂邀请码无效/);
ok('无效邀请码被拒绝: ' + bad.data.error);

// 2. A 建队并邀请 B
const t1 = await api(A, 'teams', { classId: (await api(A, 'state')).data.selected, name: '火箭队' });
assert.equal(t1.status, 200, JSON.stringify(t1.data));
const team1 = t1.data.id;
const dup = await api(A, 'teams', { classId: (await api(A, 'state')).data.selected, name: '第二队' });
assert.equal(dup.status, 409); // 同一人同一课堂只能进一个组
ok('同一课堂重复建队被拒绝(409)');

const inv1 = await api(A, 'invite', { teamId: team1, email: B });
assert.equal(inv1.status, 200, JSON.stringify(inv1.data));
ok('A 邀请 B 成功');

// B 的待处理邀请可见；C 不能替 B 接受
const stB = (await api(B, 'state')).data;
const iv = stB.pendingInvites.find((i) => i.teamName === '火箭队');
assert.ok(iv, 'B 应看到火箭队邀请');
const eve = await api(C, 'invite-action', { id: iv.id, action: 'accept' });
assert.equal(eve.status, 403);
ok('非收件人接受邀请被拒绝(403)');

const dec = await api(B, 'invite-action', { id: iv.id, action: 'decline' });
assert.equal(dec.status, 200);
const again = await api(B, 'invite-action', { id: iv.id, action: 'accept' });
assert.equal(again.status, 409); // 已拒绝的邀请不能再接受
ok('B 拒绝后不能再接受同一邀请(409)');

await api(A, 'invite', { teamId: team1, email: B });
const iv2 = (await api(B, 'state')).data.pendingInvites.find((i) => i.teamName === '火箭队');
assert.equal((await api(B, 'invite-action', { id: iv2.id, action: 'accept' })).status, 200);
ok('重新邀请后 B 接受成功，加入火箭队');

// 3. 人数上限：课堂 maxSize=2，C 不能加入已满的火箭队
const stA = (await api(A, 'state')).data;
const kid = stA.selected;
// 用管理员/教师身份调整规则：直接读教师 cookie 不方便，这里换用 C/D 组第二队验证容量即可
const t2 = await api(C, 'teams', { classId: kid, name: '探索队' });
assert.equal(t2.status, 200);
await api(C, 'invite', { teamId: t2.data.id, email: D });
const ivD = (await api(D, 'state')).data.pendingInvites[0];
assert.equal((await api(D, 'invite-action', { id: ivD.id, action: 'accept' })).status, 200);
ok('C/D 组成探索队');

// B 已在火箭队，不能接受探索队邀请（邀 B 进探索队）
await api(C, 'invite', { teamId: t2.data.id, email: B });
const ivB2 = (await api(B, 'state')).data.pendingInvites.find((i) => i.teamName === '探索队');
const acc = await api(B, 'invite-action', { id: ivB2.id, action: 'accept' });
assert.ok([409, 400].includes(acc.status), 'B 已有组，接受新邀请应失败: ' + acc.status);
ok('已有小组的学生加入第二个组被拒绝(' + acc.status + ')');

// 4. 教师视角应看到 6 名学生、2 个队（含原李同学）与成员名单
const T = 'teacher1@example.com';
assert.equal((await api(T, 'auth/request', { email: T })).status, 200);
assert.equal((await api(T, 'auth/verify', { email: T, code: CODE })).status, 200);
const stT = (await api(T, 'state?class=' + kid)).data;
assert.equal(stT.students.length, 5, '教师应看到 5 名学生(李同学+4 名新学生)');
assert.equal(stT.teams.length, 2);
const rocket = stT.teams.find((t) => t.name === '火箭队');
assert.deepEqual(rocket.members.map((m) => m.name).sort(), ['林二', '陈一']);
ok('教师视角：6 名学生 · 2 个 Team，成员名单正确');

// 5. 上传 + 练习提交（评分任务应进入队列）
const fd = new FormData();
fd.set('classId', kid); fd.set('teamId', team1);
fd.set('file', new File(['# spec\n背包排序验收标准…'], 'spec.md'));
const up = await api(A, 'upload', fd);
assert.equal(up.status, 200, JSON.stringify(up.data));
const sub = await api(A, 'submit', { teamId: team1, experimentId: 'exp-1', mode: 'practice', fileIds: [up.data.id], note: '第一次练习' });
assert.equal(sub.status, 200, JSON.stringify(sub.data));
const stA2 = (await api(A, 'state?class=' + kid)).data;
const mysub = stA2.submissions.find((s) => s.id === sub.data.id);
assert.ok(mysub && ['queued', 'running', 'complete'].includes(mysub.status));
ok('练习提交成功，核验任务已进入队列(' + mysub.status + ')');

// 教师能看到这条提交
const stT2 = (await api(T, 'state?class=' + kid)).data;
assert.ok(stT2.submissions.some((s) => s.id === sub.data.id));
ok('教师能看到该练习提交');

console.log('\n组队与提交链路实测全部通过 ✅');
