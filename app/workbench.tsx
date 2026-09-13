'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  Layers3,
  Users,
  ClipboardCheck,
  Settings2,
  Plus,
  ArrowUp,
  Paperclip,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  FileText,
  CircleHelp,
  LogOut,
  Mail,
  Check,
  Download,
  RefreshCw,
  Send,
  ShieldCheck,
  Copy,
  X,
  LoaderCircle,
  School,
  GraduationCap,
  KeyRound,
  Trash2,
  Link2,
  Inbox,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { initialCourse } from '@/lib/seed';
import { statusNames } from '@/lib/domain';
type Any = any;
const fmt = (n: number) =>
  new Date(n).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
async function call(path: string, data?: Any) {
  const r = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers:
      data instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  const v: Any = await r.json();
  if (!r.ok) throw Error(v.error || '请求未完成');
  return v;
}
const navsByRole: Record<string, readonly (readonly [string, string, Any])[]> =
  {
    admin: [
      ['studio', '课程工作台', Sparkles],
      ['courses', '实验与发布', BookOpen],
      ['overview', '课堂总览', School],
      ['feedback', '意见管理', Inbox],
      ['settings', '连接与设置', Settings2],
    ],
    teacher: [
      ['classes', '我的课堂', GraduationCap],
      ['courses', '实验内容', BookOpen],
      ['teams', '班级与 Team', Users],
      ['reports', '提交与评估', ClipboardCheck],
      ['settings', '课堂设置', Settings2],
    ],
    student: [
      ['courses', '实验内容', BookOpen],
      ['teams', '我的 Team', Users],
      ['reports', '提交与评估', ClipboardCheck],
    ],
    guest: [
      ['courses', '实验内容', BookOpen],
      ['teams', '我的 Team', Users],
      ['reports', '提交与评估', ClipboardCheck],
    ],
    pending: [
      ['courses', '实验内容', BookOpen],
      ['teams', '我的 Team', Users],
      ['reports', '提交与评估', ClipboardCheck],
    ],
  } as const;
const defaultView: Record<string, string> = {
  admin: 'studio',
  teacher: 'classes',
  student: 'courses',
};
const jobKindNames: Record<string, string> = {
  draft: '课程草案分析',
  grade: '实验评分',
  answer: '个人核验',
  email: '邮件投递',
};
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        'tag ' +
        (['complete', 'published', 'accepted'].includes(value)
          ? 'green'
          : ['failed', 'open'].includes(value)
            ? 'amber'
            : 'blue')
      }
    >
      {statusNames[value] || value}
    </span>
  );
}
function Empty({ title, body, children }: Any) {
  return (
    <div className="empty-state">
      <div className="agent-symbol">
        <Layers3 size={25} />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}
// React 19 的 onChange 对文件选择不可靠（合成事件不派发），改用原生 change 监听。
function NativeFileInput({ inputRef, onPick, accept, visible }: Any) {
  const innerRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || innerRef;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      // FileList 是活的：先复制出来再清空输入框，否则异步上传时读到的是空列表
      const files = el.files ? Array.from(el.files) : [];
      if (files.length) onPick(files);
      el.value = '';
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  });
  return (
    <input
      ref={ref}
      type="file"
      multiple
      accept={accept}
      hidden={!visible}
      aria-label={visible ? '上传作业文件' : undefined}
    />
  );
}
export default function Workbench() {
  const [s, setS] = useState<Any>({ user: null, courses: [], classes: [] });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('courses');
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<Any>(null);
  const [form, setForm] = useState<Any>({});
  const [detail, setDetail] = useState<Any>(null);
  const [token, setToken] = useState('');
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistText, setAssistText] = useState('');
  const [assistSending, setAssistSending] = useState(false);
  const [assistLocal, setAssistLocal] = useState<Any[]>([]);
  const assistScrollRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const key = s.user?.role === 'admin' ? 'course' : 'class';
      const state = await call(
        'state' +
          (selected ? '?' + key + '=' + encodeURIComponent(selected) : ''),
      );
      setS(state);
      if (state.user?.role === 'pending')
        setModal((m: Any) => m || { type: 'profile' });
      const ids = navsByRole[state.user?.role || 'guest'].map((n) => n[0]);
      setView((v) => (ids.includes(v) ? v : ids[0]));
      setLoaded(true);
    } catch (e: Any) {
      setError(e.message);
      setLoaded(true);
    }
  }, [selected, s.user?.role]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!s.user) return;
    const t = setInterval(refresh, 7000);
    return () => clearInterval(t);
  }, [refresh, s.user?.id]);
  const role: string = s.user?.role || 'guest';
  const admin = role === 'admin';
  const teacher = role === 'teacher';
  const student = role === 'student';
  const navs = navsByRole[role] || navsByRole.guest;
  const [logPage, setLogPage] = useState(1);
  const [logData, setLogData] = useState<Any>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  useEffect(() => {
    if (!admin || view !== 'settings') return;
    call('job-log?page=' + logPage)
      .then(setLogData)
      .catch(() => {});
    // 依赖 s：跟随 7 秒轮询同步刷新当前页
  }, [admin, view, logPage, s]);
  const course = admin
    ? s.courses?.find((c: Any) => c.id === s.selected)
    : s.course;
  const cls = s.classes?.find((c: Any) => c.id === s.selected);
  const draft = s.draft || initialCourse;
  const team = s.teams?.find((t: Any) => t.id === s.myTeam);
  const detailIndividual = detail?.grading === 'individual';
  const formalUsed = detail
    ? (s.submissions || []).filter(
        (x: Any) => x.experimentId === detail.id && x.mode === 'formal',
      ).length
    : 0;
  const currentNav = navs.find((n) => n[0] === view) || navs[0];
  const open = (type: string, data: Any = {}) => {
    setForm({});
    setModal({ type, ...data });
    setError('');
  };
  async function act(fn: () => Promise<Any>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e: Any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function mutation(path: string, data: Any, success = '已保存') {
    await act(async () => {
      await call(path, data);
      setNotice(success);
      setModal(null);
    });
  }
  async function ensureCourse() {
    if (course) return course.id;
    const r = await call('courses', {});
    setSelected(r.id);
    return r.id;
  }
  async function upload(files: FileList | null, asStudent = false) {
    if (!files?.length) return;
    if (!s.user) {
      open('login');
      return;
    }
    await act(async () => {
      if (asStudent && !s.selected) throw Error('请先加入课堂');
      const cid = asStudent ? s.selected : await ensureCourse();
      for (const file of Array.from(files)) {
        const data = new FormData();
        data.set(asStudent ? 'classId' : 'courseId', cid);
        data.set('file', file);
        if (asStudent && team) data.set('teamId', team.id);
        const f = await call('upload', data);
        setAttachments((a) => [...a, f]);
      }
      setNotice('文件已上传，可随消息或作业一起提交。');
    });
  }
  async function importCourse(files: File[]) {
    if (!files.length) return;
    let raw: Any;
    try {
      const parsed = JSON.parse(await files[0].text());
      raw = parsed?.course || parsed;
    } catch {
      setError('文件不是有效的 JSON');
      return;
    }
    await act(async () => {
      const r = await call('course-import', { course: raw });
      setSelected(r.id);
      setNotice('课程已导入，请检查内容后发布');
    });
  }
  const go = (id: string) => {
    setView(id);
    setDetail(null);
    setAttachments([]);
    setMessage('');
  };
  const changes = s.publishedDraft
    ? draft.experiments
        .filter(
          (e: Any) =>
            JSON.stringify(e) !==
            JSON.stringify(
              s.publishedDraft.experiments.find((p: Any) => p.id === e.id),
            ),
        )
        .map((e: Any) => e.title)
    : draft.experiments.map((e: Any) => e.title);
  const cp = (v: string) =>
    act(async () => {
      await navigator.clipboard.writeText(v);
      setNotice('已复制');
    });
  async function sendChat() {
    if (!s.user) {
      open('login');
      return;
    }
    await act(async () => {
      const cid = await ensureCourse();
      await call('chat', {
        courseId: cid,
        message:
          message ||
          '请根据附件整理实验任务与评分草案，不明确的事项请列出问题。',
        fileIds: attachments.map((a) => a.id),
      });
      setMessage('');
      setAttachments([]);
      setNotice('已进入课程分析队列，连接器接入后开始处理。');
    });
  }
  const field = (key: string, value: Any) =>
    setForm((f: Any) => ({ ...f, [key]: value }));
  const headings: Record<string, [string, string, string]> = {
    studio: [
      'COURSE STUDIO',
      '把课程想法，变成学习任务。',
      '交给小课一份文档，在对话中完善，在发布前确认。',
    ],
    courses: [
      'EXPERIMENT LIBRARY',
      '每一次实验，都有明确的标准。',
      admin
        ? '确认内容后发布，课堂里的学生看到的是已发布版本。'
        : teacher
          ? '课程管理员发布的实验内容，你的课堂按此进行。'
          : '练习获得反馈，正式提交留下可追溯的成果。',
    ],
    overview: [
      'CLASS OVERVIEW',
      '每个课堂，独立运转。',
      '查看本课程下教师开设的课堂、学生与小组规模。',
    ],
    feedback: [
      'FEEDBACK',
      '听听大家怎么说。',
      '使用问题与改进意见都汇总在这里。',
    ],
    classes: [
      'MY CLASSES',
      '开设课堂，开始教学。',
      '选择一门课程开设你的课堂，学生凭课堂邀请码加入。',
    ],
    teams: [
      'LEARN TOGETHER',
      '一起构建，一起交付。',
      '使用同一个 Team 完成实验，正式提交会保存成员快照。',
    ],
    reports: [
      'EVIDENCE & FEEDBACK',
      '让每一分，都有据可查。',
      '查看核验进度、分项反馈和需要你补充的证据。',
    ],
    settings: admin
      ? [
          'WORKSPACE CONNECTIONS',
          '让小课在你的机器上工作。',
          '网站维护课程与成绩，Pi 负责文档理解和实验核验。',
        ]
      : [
          'CLASS SETTINGS',
          '课堂规则与邀请。',
          '调整人数上限、截止时间与自动发布，分享课堂邀请码。',
        ],
  };
  const heading = headings[view] || headings.courses;
  const assistHistory: Any[] = s.assistHistory || [];
  // 本地消息与服务端历史按 角色+内容 去重，refresh 后以服务端历史为准
  const assistMsgs = [
    ...assistHistory,
    ...assistLocal.filter(
      (l) =>
        !assistHistory.some(
          (h) => h.role === l.role && h.content === l.content,
        ),
    ),
  ];
  useEffect(() => {
    const el = assistScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistMsgs.length, assistSending, assistOpen]);
  async function sendAssist() {
    const text = assistText.trim();
    if (!text || assistSending) return;
    if (!s.user) {
      open('login');
      return;
    }
    setAssistText('');
    setAssistSending(true);
    const stamp = Date.now();
    setAssistLocal((l) => [
      ...l,
      { id: 'local-' + stamp, role: 'user', content: text, created: stamp },
    ]);
    try {
      const r = await call('assist', { message: text });
      setAssistLocal((l) => [
        ...l,
        {
          id: 'local-r-' + stamp,
          role: 'assistant',
          content: r.reply,
          created: Date.now(),
        },
      ]);
      refresh();
    } catch (e: Any) {
      setAssistLocal((l) => [
        ...l,
        {
          id: 'local-e-' + stamp,
          role: 'system',
          content: e.message,
          created: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setAssistSending(false);
    }
  }
  const inviteBanners = (list: Any[]) =>
    list?.map((iv: Any) => (
      <div className="invite-banner" key={iv.id}>
        <Mail size={20} />
        <div>
          <strong>{iv.teamName} 邀请你加入</strong>
          <p>接受后自动加入相应课堂。</p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            mutation('invite-action', { id: iv.id, action: 'decline' })
          }
        >
          拒绝
        </Button>
        <Button
          onClick={() =>
            mutation('invite-action', { id: iv.id, action: 'accept' })
          }
        >
          接受邀请
        </Button>
      </div>
    ));
  const joinEmpty = (
    <>
      <Empty
        title="先加入一个课堂"
        body="输入教师分享给你的课堂邀请码，加入后即可开始实验。"
      >
        <Button onClick={() => open('join')}>输入课堂邀请码</Button>
      </Empty>
      {inviteBanners(s.pendingInvites)}
    </>
  );
  const noClass = (
    <Empty
      title="先开设一个课堂"
      body="选择一门课程开设课堂后，这里才会出现班级、提交与设置。"
    >
      <Button onClick={() => open('newClass')}>开设课堂</Button>
    </Empty>
  );
  return (
    <SidebarProvider>
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <a className="brand" href="/">
            <span className="brand-mark">
              <Layers3 size={24} />
            </span>
            <span>
              课序<small>COURSE / LOOP</small>
            </span>
          </a>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>
              {admin
                ? '课程管理工作台'
                : teacher
                  ? '教学工作空间'
                  : '学习工作空间'}
            </SidebarGroupLabel>
            <SidebarMenu>
              {navs.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={view === id}
                    onClick={() => go(id)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <div className="sidebar-course">
            <span className="tiny-label">
              {!s.user || admin ? '当前课程' : '当前课堂'}
            </span>
            {!s.user || admin ? (
              s.courses?.length ? (
                <>
                  <strong>{course?.title || '未选择课程'}</strong>
                  <span>
                    {course
                      ? `${course.term} · 草案 v${course.revision}${course.publishedId ? ' · 已发布' : ''}`
                      : '在课程工作台选择课程'}
                  </span>
                </>
              ) : (
                <>
                  <strong>还没有课程</strong>
                  <span>在课程工作台新建</span>
                </>
              )
            ) : s.classes?.length ? (
              <Select
                value={s.selected}
                onValueChange={(v) => {
                  setSelected(String(v));
                  setAttachments([]);
                  setDetail(null);
                }}
              >
                <SelectTrigger className="course-select">
                  <SelectValue>
                    {(v: string) => {
                      const c = s.classes?.find((x: Any) => x.id === v);
                      return c ? `${c.courseTitle} · ${c.name}` : v;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {s.classes.map((c: Any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.courseTitle} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <strong>{teacher ? '尚未开设课堂' : '尚未加入课堂'}</strong>
                <span>
                  {teacher ? '从「我的课堂」开设' : '使用课堂邀请码加入'}
                </span>
              </>
            )}
            <div className="course-line">
              <i />
            </div>
            <small>从规格到可信交付</small>
          </div>
          {student && (
            <div className="sidebar-join">
              <Button className="primary w-full" onClick={() => open('join')}>
                <Plus size={16} />
                加入课堂
              </Button>
            </div>
          )}
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-person">
            <span className="avatar">{s.user?.name?.slice(0, 1) || '课'}</span>
            <div>
              {s.user?.name || '欢迎来到课序'}
              <small>
                {s.user
                  ? s.user.role === 'pending'
                    ? '待完善信息'
                    : admin
                      ? '课程管理员'
                      : teacher
                        ? '教师'
                        : s.user.studentNo || '学生'
                  : '登录后开始协作'}
              </small>
            </div>
            {s.user ? (
              <button
                aria-label="退出登录"
                onClick={() =>
                  act(async () => {
                    await call('auth/logout', {});
                    setSelected('');
                    setView('courses');
                  })
                }
              >
                <LogOut size={16} />
              </button>
            ) : (
              <button onClick={() => open('login')}>登录</button>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>工作空间</span>
            <ChevronRight size={15} />
            <strong>{currentNav[1]}</strong>
          </div>
          <div>
            <span
              className={
                'connection ' +
                (s.health?.online && s.health?.acp ? 'online' : '')
              }
            >
              <i />
              {s.health?.online && s.health?.acp
                ? 'Pi 已连接'
                : s.health?.acpFound === false
                  ? 'Pi 未连接'
                  : s.health?.acpError
                    ? 'Pi 待配置'
                    : 'Pi 未连接'}
            </span>
            {!s.user && (
              <Button size="sm" variant="outline" onClick={() => open('login')}>
                <Mail size={15} />
                邮箱登录
              </Button>
            )}
          </div>
        </header>
        <main className="workspace">
          {error && (
            <div className="feedback error" role="alert">
              {error}
              <button aria-label="关闭错误" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="feedback" role="status">
              {notice}
              <button aria-label="关闭提示" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="busy-indicator" role="status">
              <LoaderCircle size={16} className="spin" />
              正在处理…
            </div>
          )}
          <div className="page-heading">
            <div className="eyebrow">
              {heading[0]}
              <span>{course?.term || cls?.term || '2026 / AUTUMN'}</span>
            </div>
            <div className="heading-row">
              <div>
                <h1>{heading[1]}</h1>
                <p>{heading[2]}</p>
              </div>
              {admin ? (
                view === 'studio' && (
                  <Button className="primary" onClick={() => open('newCourse')}>
                    <Plus size={17} />
                    新建课程
                  </Button>
                )
              ) : teacher ? (
                view === 'classes' && (
                  <Button className="primary" onClick={() => open('newClass')}>
                    <Plus size={17} />
                    开设课堂
                  </Button>
                )
              ) : s.user ? null : (
                <Button className="primary" onClick={() => open('login')}>
                  <ArrowUpRight size={17} />
                  进入工作空间
                </Button>
              )}
            </div>
          </div>
          {view === 'studio' && admin && (
            <>
              <section className="panel data-panel">
                <h2>课程管理</h2>
                <div className="lab-grid">
                  {s.courses?.map((c: Any) => (
                    <div
                      className={
                        'lab-card panel' +
                        (s.selected === c.id ? ' chosen' : '')
                      }
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (s.selected !== c.id) {
                          setSelected(c.id);
                          setAttachments([]);
                          setDetail(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(c.id);
                        }
                      }}
                    >
                      <div className="lab-top">
                        <span className="tag">{c.term}</span>
                        <span className="tag">
                          {c.publishedId ? '已发布' : '草案'}
                        </span>
                      </div>
                      <h2>{c.title}</h2>
                      <p>
                        {c.classCount || 0} 个课堂 · 草案 v{c.revision}
                      </p>
                      <div className="lab-bottom">
                        <span>
                          {s.selected === c.id ? '正在编排' : '点击编排内容'}
                        </span>
                        <span className="button-row">
                          <a
                            className="text-action"
                            href={'/api/course-export?course=' + c.id}
                            download
                            onClick={(e) => e.stopPropagation()}
                          >
                            导出
                          </a>
                          <button
                            aria-label={'删除 ' + c.title}
                            onClick={(e) => {
                              e.stopPropagation();
                              open('delCourse', {
                                courseId: c.id,
                                title: c.title,
                                term: c.term,
                              });
                            }}
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                  <button
                    className="lab-card panel"
                    onClick={() => open('newCourse')}
                  >
                    <div className="lab-top">
                      <span className="tag">新课程</span>
                    </div>
                    <h2>
                      <Plus size={17} /> 新建课程
                    </h2>
                    <p>空白起步或复制当前课程，之后用对话编排内容。</p>
                  </button>
                  <button
                    className="lab-card panel"
                    onClick={() => importRef.current?.click()}
                  >
                    <div className="lab-top">
                      <span className="tag">JSON</span>
                    </div>
                    <h2>
                      <Download size={17} /> 导入课程
                    </h2>
                    <p>从导出的课程 JSON 文件恢复完整实验内容。</p>
                  </button>
                  <NativeFileInput
                    inputRef={importRef}
                    onPick={(f: File[]) => importCourse(f)}
                    accept=".json,application/json"
                  />
                </div>
              </section>
              <div className="studio-grid">
                <section className="conversation panel">
                  <div className="panel-title">
                    <span>
                      <Sparkles size={18} />
                      与小课协作
                    </span>
                    <span className="tag">
                      {course ? `草案 v${course.revision}` : '草案阶段'}
                    </span>
                  </div>
                  <div className="conversation-body">
                    {s.messages?.length ? (
                      <div className="messages">
                        {s.messages.map((m: Any) => (
                          <article className={'message ' + m.role} key={m.id}>
                            <div className="message-label">
                              {m.role === 'user' ? '你' : '小课'}
                              <small>{fmt(m.created)}</small>
                            </div>
                            <p>{m.content}</p>
                            {JSON.parse(m.fileIds || '[]').map(
                              (fid: string) => (
                                <a
                                  className="file-link"
                                  href={'/api/files/' + fid}
                                  key={fid}
                                >
                                  <Paperclip size={13} />
                                  {s.files?.find((f: Any) => f.id === fid)
                                    ?.name || '附件'}
                                </a>
                              ),
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="agent-symbol">
                          <Sparkles size={23} />
                        </div>
                        <h2>从你已有的材料开始</h2>
                        <p>
                          上传教学大纲、实验指导或评分文档。小课
                          会整理任务和评分项，把需要你决定的地方留在这里。
                        </p>
                        <div className="starter-prompts">
                          <button
                            onClick={() =>
                              setMessage(
                                '请检查这四次实验的任务、提交要求和评分标准是否一致。',
                              )
                            }
                          >
                            <FileText size={17} />
                            检查四次实验的一致性
                            <ArrowUpRight size={15} />
                          </button>
                          <button
                            onClick={() =>
                              setMessage(
                                '请根据我上传的课程文档生成实验任务和评分草案。',
                              )
                            }
                          >
                            <Layers3 size={17} />
                            从文档生成课程草案
                            <ArrowUpRight size={15} />
                          </button>
                        </div>
                      </>
                    )}
                    {s.jobs
                      ?.filter((j: Any) => j.status !== 'complete')
                      .slice(0, 3)
                      .map((j: Any) => (
                        <div className="job-note" key={j.id}>
                          <Status value={j.status} />
                          <span>{j.error || '课程分析任务'}</span>
                          {j.status === 'failed' ? (
                            <button
                              onClick={() =>
                                mutation('job-action', {
                                  id: j.id,
                                  action: 'retry',
                                })
                              }
                            >
                              重试
                            </button>
                          ) : ['queued', 'running'].includes(j.status) ? (
                            <button
                              onClick={() =>
                                mutation('job-action', {
                                  id: j.id,
                                  action: 'cancel',
                                })
                              }
                            >
                              取消
                            </button>
                          ) : null}
                        </div>
                      ))}
                    <div className="notice">
                      <CircleHelp size={16} />
                      <span>
                        {s.health?.online
                          ? '有歧义时，小课会在这里追问。'
                          : '连接 Pi 后开始分析。四次实验已预置，可先预览和发布。'}
                      </span>
                    </div>
                  </div>
                  <div className="composer">
                    {attachments.length > 0 && (
                      <div className="attachment-list">
                        {attachments.map((f) => (
                          <span key={f.id}>
                            <FileText size={13} />
                            {f.name}
                            <button
                              aria-label={'移除 ' + f.name}
                              onClick={() =>
                                setAttachments((a) =>
                                  a.filter((x) => x.id !== f.id),
                                )
                              }
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <textarea
                      aria-label="给小课的消息"
                      placeholder="描述你的想法，或附上一份文档…"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => uploadRef.current?.click()}
                      >
                        <Paperclip size={17} />
                        添加文档
                      </Button>
                      <NativeFileInput
                        inputRef={uploadRef}
                        onPick={(f: FileList) => upload(f)}
                        accept=".md,.txt,.docx,.pdf"
                      />
                      <button
                        className="send"
                        aria-label="发送给小课"
                        disabled={
                          busy || (!message.trim() && !attachments.length)
                        }
                        onClick={sendChat}
                      >
                        <ArrowUp size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="composer-hint">
                    修改先进入草案，确认后才会发布给课堂。
                  </div>
                </section>
                <section className="course-preview">
                  <div className="preview-heading">
                    <span className="tiny-label">课程预览</span>
                    <span className="tag blue">
                      {draft.experiments.length} 次实验
                    </span>
                  </div>
                  <h2>{draft.title}</h2>
                  <p className="muted">{draft.description}</p>
                  <div className="course-facts">
                    <span>32 学时</span>
                    <span>8 周</span>
                    <span>Team 协作</span>
                  </div>
                  {draft.questions?.length > 0 && (
                    <div className="questions">
                      <strong>需要你确认</strong>
                      {draft.questions.map((q: string, i: number) => (
                        <button
                          key={i}
                          onClick={() => setMessage(`关于“${q}”，我的决定是：`)}
                        >
                          {i + 1}. {q}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="experiment-list">
                    {draft.experiments.map((e: Any, i: number) => (
                      <button
                        key={e.id}
                        className="experiment-card"
                        onClick={() => {
                          go('courses');
                          setDetail(e);
                        }}
                      >
                        <div className="experiment-number">
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div>
                          <div className="experiment-meta">
                            {e.week}
                            <span>
                              {e.rubric.reduce(
                                (n: number, r: Any) => n + r.max,
                                0,
                              )}{' '}
                              分
                            </span>
                          </div>
                          <h3>{e.title}</h3>
                          <p>{e.summary}</p>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                  <div className="preview-bottom">
                    <span>
                      <span className="dot" />
                      {s.release
                        ? `已发布 v${s.release.revision}`
                        : '预置课程 · 待发布'}
                    </span>
                    <Button variant="outline" onClick={() => go('courses')}>
                      查看完整草案
                      <ArrowUpRight size={16} />
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}
          {view === 'overview' && admin && (
            <>
              {!course ? (
                <Empty
                  title="先选择一门课程"
                  body="在课程工作台选择或新建课程后，这里会显示该课程下的全部课堂。"
                />
              ) : (
                <>
                  <div className="toolbar">
                    <span className="muted">
                      {s.courseClasses?.length || 0} 个课堂 ·
                      教师凭课堂邀请码招收学生
                    </span>
                  </div>
                  <div className="teams-grid">
                    {s.courseClasses?.map((c: Any) => (
                      <section className="panel team-card" key={c.id}>
                        <div className="section-heading">
                          <div className="team-title">
                            <span className="team-icon">
                              <School size={22} />
                            </span>
                            <div>
                              <h2>{c.name}</h2>
                              <span className="muted">{c.teacherName}</span>
                            </div>
                          </div>
                        </div>
                        <div className="member">
                          <Users size={16} />
                          <div>
                            <strong>{c.students} 位学生</strong>
                            <small>{c.teams} 个 Team</small>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                  {!s.courseClasses?.length && (
                    <Empty
                      title="还没有课堂"
                      body="教师注册后可以在「我的课堂」选择本课程开设课堂。"
                    />
                  )}
                </>
              )}
            </>
          )}
          {view === 'feedback' && admin && (
            <>
              <div className="toolbar">
                <span className="muted">
                  {s.feedbackList?.length || 0} 条意见 ·
                  来自「问小课」面板的提交，按时间倒序
                </span>
              </div>
              {s.feedbackList?.length ? (
                <section className="panel">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead>内容</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.feedbackList.map((f: Any) => (
                        <TableRow key={f.id}>
                          <TableCell>{fmt(f.created)}</TableCell>
                          <TableCell>
                            {f.userName}
                            <div className="muted">
                              {f.userEmail} ·{' '}
                              {f.userRole === 'admin'
                                ? '管理员'
                                : f.userRole === 'teacher'
                                  ? '教师'
                                  : '学生'}
                            </div>
                          </TableCell>
                          <TableCell className="fb-content">
                            {f.content}
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                'tag ' +
                                (f.status === 'open' ? 'amber' : 'blue')
                              }
                            >
                              {f.status === 'open' ? '待处理' : '已处理'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                mutation(
                                  'feedback-action',
                                  {
                                    id: f.id,
                                    action:
                                      f.status === 'open' ? 'close' : 'open',
                                  },
                                  f.status === 'open'
                                    ? '已标记处理'
                                    : '已重新打开',
                                )
                              }
                            >
                              {f.status === 'open' ? '标记已处理' : '重新打开'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              ) : (
                <Empty
                  title="暂无意见"
                  body="用户通过右下角「问小课」面板提交的改进意见会显示在这里。"
                />
              )}
            </>
          )}
          {view === 'classes' && teacher && (
            <>
              <div className="toolbar">
                <span className="muted">
                  {s.classes?.length || 0} 个课堂 · 每个课堂相互独立
                </span>
              </div>
              <div className="teams-grid">
                {s.classes?.map((c: Any) => (
                  <section className="panel team-card" key={c.id}>
                    <div className="section-heading">
                      <div className="team-title">
                        <span className="team-icon">
                          <GraduationCap size={22} />
                        </span>
                        <div>
                          <h2>{c.name}</h2>
                          <span className="muted">
                            {c.courseTitle} · {c.term}
                          </span>
                        </div>
                      </div>
                      {s.selected === c.id ? (
                        <span className="tag blue">当前课堂</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelected(c.id);
                            go('courses');
                          }}
                        >
                          进入课堂
                        </Button>
                      )}
                    </div>
                    <div className="member">
                      <KeyRound size={16} />
                      <div>
                        <strong>课堂邀请码 {c.joinCode}</strong>
                        <small>
                          小组上限 {c.maxSize} 人 · 截止{' '}
                          {c.deadline ? fmt(c.deadline) : '未设置'}
                        </small>
                      </div>
                      <button
                        className="text-action"
                        onClick={() => cp(c.joinCode)}
                      >
                        复制
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              {!s.classes?.length && (
                <Empty
                  title="还没有课堂"
                  body="选择一门课程开设你的课堂，学生会通过课堂邀请码加入。"
                >
                  <Button onClick={() => open('newClass')}>开设课堂</Button>
                </Empty>
              )}
            </>
          )}
          {view === 'courses' && (
            <>
              {student && !cls ? (
                joinEmpty
              ) : teacher && !cls ? (
                noClass
              ) : (
                <>
                  {s.files?.filter((f: Any) => !f.teamId).length > 0 && (
                    <section className="panel data-panel">
                      <h2>课程文档与素材</h2>
                      {s.files
                        .filter((f: Any) => !f.teamId)
                        .map((f: Any) => (
                          <div className="member" key={f.id}>
                            <FileText size={18} />
                            <a
                              className="file-link"
                              href={'/api/files/' + f.id}
                            >
                              {f.name}
                            </a>
                            <span className="tag">
                              {f.visibility === 'student'
                                ? '学生可见'
                                : '教师内部'}
                            </span>
                            {admin && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  mutation('file-visibility', {
                                    id: f.id,
                                    shared: f.visibility !== 'student',
                                  })
                                }
                              >
                                {f.visibility === 'student'
                                  ? '设为内部'
                                  : '共享给学生'}
                              </Button>
                            )}
                            {admin && (
                              <button
                                className="text-action danger"
                                onClick={() =>
                                  open('delFile', {
                                    fileId: f.id,
                                    name: f.name,
                                  })
                                }
                              >
                                删除
                              </button>
                            )}
                          </div>
                        ))}
                    </section>
                  )}
                  <div className="toolbar">
                    <span className="muted">
                      {admin
                        ? '确认内容后发布，学生看到的是已发布版本。'
                        : teacher
                          ? '以下为课程管理员发布的实验内容，只读。'
                          : s.release
                            ? '以下是已发布的实验要求。'
                            : '实验发布后即可开始练习。'}
                    </span>
                    {admin && (
                      <Button
                        disabled={
                          busy ||
                          !course ||
                          course.revision === s.release?.revision
                        }
                        onClick={() => open('publish')}
                      >
                        <Send size={16} />
                        预览并发布
                      </Button>
                    )}
                  </div>
                  <div className="lab-grid">
                    {(s.user && !admin && !s.release
                      ? []
                      : draft.experiments
                    ).map((e: Any, i: number) => (
                      <button
                        className={
                          'lab-card panel ' +
                          (detail?.id === e.id ? 'chosen' : '')
                        }
                        key={e.id}
                        onClick={() => {
                          setDetail(e);
                          setAttachments([]);
                        }}
                      >
                        <div className="lab-top">
                          <span className="experiment-number">0{i + 1}</span>
                          <span className="tag">{e.week}</span>
                          <span className="tag blue">
                            {e.grading === 'individual'
                              ? '个人判分'
                              : '小组判分'}
                          </span>
                        </div>
                        <h2>{e.title}</h2>
                        <p>{e.summary}</p>
                        <div className="lab-bottom">
                          <span>
                            {e.grading === 'individual'
                              ? '个人提交'
                              : 'Team 提交'}
                          </span>
                          <span>
                            {e.rubric.reduce(
                              (n: number, r: Any) => n + r.max,
                              0,
                            )}{' '}
                            分
                            <ArrowUpRight size={16} />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {s.user && !admin && !s.release && (
                    <Empty
                      title="实验尚未发布"
                      body={
                        teacher
                          ? '课程管理员发布实验后，你的课堂即可开始。'
                          : '等待课程管理员发布实验任务。'
                      }
                    />
                  )}
                  {detail && (
                    <section className="panel detail-panel">
                      <div className="section-heading">
                        <div>
                          <span className="tiny-label">EXPERIMENT DETAILS</span>
                          <h2>{detail.title}</h2>
                          <span className="tag blue">
                            {detailIndividual ? '个人判分' : '小组判分'}
                          </span>
                        </div>
                        <button
                          aria-label="收起实验详情"
                          onClick={() => setDetail(null)}
                        >
                          <X size={19} />
                        </button>
                      </div>
                      <div className="detail-columns">
                        <div>
                          <h3>任务与约束</h3>
                          <p className="prose-text">{detail.task}</p>
                          <h3>提交清单</h3>
                          <ul>
                            {detail.deliverables.map((d: string) => (
                              <li key={d}>{d}</li>
                            ))}
                          </ul>
                          <h3>课程素材</h3>
                          {detail.sourceFiles?.map((f: string) => (
                            <a
                              className="file-link"
                              href={'/materials/' + f + '.zip'}
                              key={f}
                            >
                              <Download size={14} />
                              {f}.zip
                            </a>
                          ))}
                        </div>
                        <div>
                          <h3>评分标准</h3>
                          {detail.rubric.map((r: Any) => (
                            <div className="rubric-row" key={r.id}>
                              <div>
                                <strong>{r.title}</strong>
                                <p>{r.criteria}</p>
                              </div>
                              <span>{r.max} 分</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {student && (
                        <div className="submission-box">
                          <h3>
                            {detailIndividual ? '提交我的成果' : '提交本组成果'}
                          </h3>
                          {!team && !detailIndividual ? (
                            <p className="muted">
                              请先在“我的 Team”创建或加入小组。
                            </p>
                          ) : (
                            <>
                              <p className="muted">
                                {detailIndividual
                                  ? `${s.user.name} · 个人判分实验，无需小组，以你本人名义提交。`
                                  : `${team.name} · `}
                                上传 ZIP、Markdown 或相关证据。单个文件不超过 20
                                MB。
                              </p>
                              <NativeFileInput
                                visible
                                onPick={(f: FileList) => upload(f, true)}
                              />
                              <div className="attachment-list">
                                {attachments.map((f) => (
                                  <span key={f.id}>
                                    {f.name}
                                    <button
                                      aria-label="移除附件"
                                      onClick={() =>
                                        setAttachments((a) =>
                                          a.filter((x) => x.id !== f.id),
                                        )
                                      }
                                    >
                                      <X size={12} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                              <textarea
                                className="text-area"
                                placeholder="说明分工、运行方式及需要核验的内容"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                              />
                              <div className="button-row">
                                <Button
                                  variant="outline"
                                  disabled={busy || !attachments.length}
                                  onClick={() =>
                                    mutation(
                                      'submit',
                                      {
                                        experimentId: detail.id,
                                        mode: 'practice',
                                        fileIds: attachments.map((f) => f.id),
                                        note: message,
                                      },
                                      '练习已进入核验队列',
                                    )
                                  }
                                >
                                  提交练习
                                </Button>
                                <Button
                                  disabled={
                                    busy ||
                                    !attachments.length ||
                                    formalUsed >= 3 ||
                                    (!detailIndividual &&
                                      team.leader !== s.user.id)
                                  }
                                  onClick={() => open('formal')}
                                >
                                  {detailIndividual
                                    ? '提交我的作业'
                                    : '确认正式提交'}
                                </Button>
                                <span className="muted">
                                  {formalUsed >= 3
                                    ? '正式提交次数已用完（3 次），取最高分计成绩。'
                                    : detailIndividual
                                      ? `正式提交以你本人名义进行，每个实验最多 3 次（已用 ${formalUsed} 次），取最高分计成绩。`
                                      : `正式提交由组长确认，每个实验最多 3 次（已用 ${formalUsed} 次），取最高分计成绩。`}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          {view === 'teams' &&
            (!s.user ? (
              <Empty
                title="用邮箱加入你的学习小组"
                body="注册后加入课堂，创建 Team 或接受同学的邀请。"
              >
                <Button onClick={() => open('login')}>注册 / 登录</Button>
              </Empty>
            ) : student && !cls ? (
              joinEmpty
            ) : teacher && !cls ? (
              noClass
            ) : (
              <>
                <div className="toolbar">
                  <span>
                    {teacher
                      ? `${s.students?.length || 0} 位学生 · ${s.teams?.length || 0} 个 Team`
                      : `每组最多 ${cls?.maxSize || 4} 人 · 同一课堂只能加入一个 Team`}
                  </span>
                  {teacher
                    ? cls?.joinCode && (
                        <Button
                          variant="outline"
                          onClick={() => cp(cls.joinCode)}
                        >
                          <Copy size={15} />
                          课堂邀请码：{cls.joinCode}
                        </Button>
                      )
                    : !team && (
                        <Button onClick={() => open('createTeam')}>
                          <Plus size={16} />
                          创建 Team
                        </Button>
                      )}
                </div>
                {s.invites
                  ?.filter(
                    (i: Any) =>
                      i.status === 'pending' && i.email === s.user.email,
                  )
                  .map((iv: Any) => (
                    <div className="invite-banner" key={iv.id}>
                      <Mail size={20} />
                      <div>
                        <strong>{iv.teamName} 邀请你加入</strong>
                        <p>接受后将成为这个 Team 的成员。</p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() =>
                          mutation('invite-action', {
                            id: iv.id,
                            action: 'decline',
                          })
                        }
                      >
                        拒绝
                      </Button>
                      <Button
                        onClick={() =>
                          mutation('invite-action', {
                            id: iv.id,
                            action: 'accept',
                          })
                        }
                      >
                        接受邀请
                      </Button>
                    </div>
                  ))}
                <div className="teams-grid">
                  {s.teams?.map((t: Any) => (
                    <section className="panel team-card" key={t.id}>
                      <div className="section-heading">
                        <div className="team-title">
                          <span className="team-icon">
                            <Users size={22} />
                          </span>
                          <div>
                            <h2>{t.name}</h2>
                            <span className="muted">
                              {t.members.length} / {cls?.maxSize || 4} 人
                            </span>
                          </div>
                        </div>
                        {t.leader === s.user.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => open('invite', { teamId: t.id })}
                          >
                            <Plus size={15} />
                            邀请
                          </Button>
                        )}
                      </div>
                      {t.members.map((m: Any) => (
                        <div className="member" key={m.id}>
                          <span className="avatar">{m.name.slice(0, 1)}</span>
                          <div>
                            <strong>{m.name}</strong>
                            <small>
                              {m.email} · {m.studentNo}
                            </small>
                          </div>
                          {t.leader === m.id ? (
                            <span className="tag blue">组长</span>
                          ) : (
                            <>
                              {t.leader === s.user.id && (
                                <>
                                  <button
                                    className="text-action"
                                    onClick={() =>
                                      open('teamConfirm', {
                                        teamId: t.id,
                                        userId: m.id,
                                        action: 'transfer',
                                        label: `将组长转让给 ${m.name}`,
                                      })
                                    }
                                  >
                                    转让
                                  </button>
                                  <button
                                    className="text-action danger"
                                    onClick={() =>
                                      open('teamConfirm', {
                                        teamId: t.id,
                                        userId: m.id,
                                        action: 'remove',
                                        label: `移除成员 ${m.name}`,
                                      })
                                    }
                                  >
                                    移除
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      {(t.repo ||
                        t.members.some((m: Any) => m.id === s.user.id)) && (
                        <div className="member">
                          <span className="avatar">
                            <Link2 size={15} />
                          </span>
                          <div>
                            {t.repo ? (
                              <>
                                <a
                                  href={t.repo}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t.repo}
                                </a>
                                <small>提交核验时会参考该仓库</small>
                              </>
                            ) : (
                              <small className="muted">
                                尚未设置 GitHub 仓库地址
                              </small>
                            )}
                          </div>
                          {t.repo && (
                            <button
                              className="text-action"
                              onClick={() => cp(t.repo)}
                            >
                              复制
                            </button>
                          )}
                          {t.members.some((m: Any) => m.id === s.user.id) && (
                            <button
                              className="text-action"
                              onClick={() => {
                                open('repo', { teamId: t.id });
                                setForm({ repo: t.repo || '' });
                              }}
                            >
                              {t.repo ? '修改' : '设置'}
                            </button>
                          )}
                        </div>
                      )}
                      {student && t.leader !== s.user.id && (
                        <Button
                          className="mt-4"
                          variant="outline"
                          onClick={() =>
                            open('teamConfirm', {
                              teamId: t.id,
                              action: 'leave',
                              label: '退出这个 Team',
                            })
                          }
                        >
                          退出小组
                        </Button>
                      )}
                    </section>
                  ))}
                </div>
                {!s.teams?.length && (
                  <Empty
                    title="还没有 Team"
                    body={
                      teacher
                        ? '学生加入课堂后，可以自行组队并邀请同学。'
                        : '创建你的小组，或请组长使用你的邮箱发出邀请。'
                    }
                  />
                )}
                {teacher && (
                  <section className="panel data-panel">
                    <h2>课堂学生</h2>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>姓名</TableHead>
                          <TableHead>学号</TableHead>
                          <TableHead>邮箱</TableHead>
                          <TableHead>组队状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.students?.map((m: Any) => (
                          <TableRow key={m.id}>
                            <TableCell>{m.name}</TableCell>
                            <TableCell>{m.studentNo}</TableCell>
                            <TableCell>{m.email}</TableCell>
                            <TableCell>
                              {s.teams?.find((t: Any) => t.id === m.teamId)
                                ?.name || '尚未组队'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                )}
              </>
            ))}
          {view === 'reports' &&
            (student && !cls ? (
              joinEmpty
            ) : teacher && !cls ? (
              noClass
            ) : (
              <>
                <div className="toolbar">
                  <span className="muted">
                    {s.submissions?.length || 0} 次提交 · 系统异常不会直接计零分
                  </span>
                  <div className="button-row">
                    <Button variant="outline" size="sm" onClick={refresh}>
                      <RefreshCw size={14} />
                      刷新
                    </Button>
                    {teacher && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const rows = [
                            ['小组', '实验', '类型', '版本', '分数', '状态'],
                            ...(s.submissions || []).map((x: Any) => [
                              x.teamName || x.members?.[0]?.name || '',
                              x.experimentId,
                              x.mode,
                              x.ordinal,
                              x.report?.total ?? '',
                              x.status,
                            ]),
                          ];
                          const csv =
                            '﻿' +
                            rows
                              .map((row) =>
                                row
                                  .map(
                                    (x: Any) =>
                                      '"' +
                                      String(x)
                                        .replace(/^[=+@-]/, "'")
                                        .replaceAll('"', '""') +
                                      '"',
                                  )
                                  .join(','),
                              )
                              .join('\r\n');
                          const a = document.createElement('a');
                          const u = URL.createObjectURL(
                            new Blob([csv], { type: 'text/csv' }),
                          );
                          a.href = u;
                          a.download = '实验成绩.csv';
                          a.click();
                          URL.revokeObjectURL(u);
                        }}
                      >
                        <Download size={14} />
                        导出成绩
                      </Button>
                    )}
                  </div>
                </div>
                {!s.submissions?.length ? (
                  <Empty
                    title="还没有提交记录"
                    body="小组上传练习或正式成果后，核验进度和分项反馈会出现在这里。"
                  >
                    <Button variant="outline" onClick={() => go('courses')}>
                      查看实验任务
                    </Button>
                  </Empty>
                ) : (
                  <div className="report-list">
                    {s.submissions.map((sub: Any) => (
                      <section className="panel report-card" key={sub.id}>
                        <div className="section-heading">
                          <div>
                            <div className="button-row">
                              <span className="tag">
                                {sub.mode === 'practice' ? '练习' : '正式'} · v
                                {sub.ordinal}
                                {sub.superseded ? ' · 已被替代' : ''}
                              </span>
                              {sub.isBest && (
                                <span className="tag green">最佳成绩</span>
                              )}
                              <Status value={sub.status} />
                            </div>
                            <h2>
                              {draft.experiments.find(
                                (e: Any) => e.id === sub.experimentId,
                              )?.title || sub.experimentId}
                            </h2>
                            <p className="muted">
                              {sub.teamName || sub.members[0]?.name} ·{' '}
                              {fmt(sub.created)} · 快照成员：
                              {sub.members.map((m: Any) => m.name).join('、')}
                            </p>
                          </div>
                          <div className="score">
                            {sub.report ? sub.report.total : '—'}
                            <small>
                              /{' '}
                              {draft.experiments
                                .find((e: Any) => e.id === sub.experimentId)
                                ?.rubric.reduce(
                                  (n: number, r: Any) => n + r.max,
                                  0,
                                ) || 100}
                            </small>
                          </div>
                        </div>
                        {sub.error && (
                          <div className="feedback error">{sub.error}</div>
                        )}
                        {sub.report ? (
                          <>
                            <div className="score-items">
                              {sub.report.items.map((i: Any) => (
                                <div key={i.id}>
                                  <strong>
                                    {draft.experiments
                                      .find(
                                        (e: Any) => e.id === sub.experimentId,
                                      )
                                      ?.rubric.find((r: Any) => r.id === i.id)
                                      ?.title || i.id}
                                    <span>{i.score} 分</span>
                                  </strong>
                                  <p>{i.reason}</p>
                                  <small>证据:{i.evidence.join('；')}</small>
                                </div>
                              ))}
                            </div>
                            {sub.report.limitations?.length > 0 && (
                              <div className="questions">
                                <strong>尚未核验</strong>
                                {sub.report.limitations.map(
                                  (l: string, i: number) => (
                                    <p key={i}>{l}</p>
                                  ),
                                )}
                              </div>
                            )}
                            {sub.report.questions?.length > 0 && (
                              <div className="questions">
                                <strong>个人核验</strong>
                                {sub.report.questions.map(
                                  (q: string, i: number) => (
                                    <p key={i}>
                                      {i + 1}. {q}
                                    </p>
                                  ),
                                )}
                                {student && !sub.answers?.length && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      open('answer', { submissionId: sub.id })
                                    }
                                  >
                                    回答问题
                                  </Button>
                                )}
                                {sub.answers?.map((a: Any) => (
                                  <div className="answer-record" key={a.id}>
                                    <p>{a.content}</p>
                                    <Status value={a.status} />
                                    {a.result?.feedback && (
                                      <p>{a.result.feedback}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="muted py-5">
                            {sub.status === 'complete'
                              ? '评分已生成，等待教师复核发布。'
                              : sub.status === 'queued'
                                ? '等待 Pi 连接器领取任务。系统不会生成模拟分数。'
                                : '核验结果将在完成后展示。'}
                          </p>
                        )}
                        <div className="button-row">
                          {sub.fileIds.map((fid: string) => (
                            <a
                              className="file-link"
                              href={'/api/files/' + fid}
                              key={fid}
                            >
                              <Download size={13} />
                              {s.files?.find((f: Any) => f.id === fid)?.name ||
                                '提交文件'}
                            </a>
                          ))}
                        </div>
                        <div className="report-actions">
                          {sub.status === 'failed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                mutation('job-action', {
                                  id: sub.jobId,
                                  action: 'retry',
                                })
                              }
                            >
                              重试核验
                            </Button>
                          )}
                          {teacher && sub.report && (
                            <Button
                              size="sm"
                              onClick={() => open('review', { sub })}
                            >
                              {sub.published ? '复核 / 调整' : '复核并发布'}
                            </Button>
                          )}
                          {student && sub.report && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                open('appeal', { submissionId: sub.id })
                              }
                            >
                              对评分提出申诉
                            </Button>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
                {s.appeals?.length > 0 && (
                  <section className="panel data-panel">
                    <h2>申诉与复核记录</h2>
                    {s.appeals.map((a: Any) => (
                      <div className="appeal-row" key={a.id}>
                        <Status value={a.status} />
                        <div>
                          <p>{a.content}</p>
                          {a.resolution && (
                            <small>处理意见:{a.resolution}</small>
                          )}
                        </div>
                        {teacher && a.status === 'open' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              open('review', {
                                sub: s.submissions.find(
                                  (x: Any) => x.id === a.submissionId,
                                ),
                                appealId: a.id,
                              })
                            }
                          >
                            处理
                          </Button>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            ))}
          {view === 'settings' &&
            (admin ? (
              <div className="settings-grid">
                <section className="panel settings-card">
                  <div className="agent-symbol">
                    <Sparkles size={23} />
                  </div>
                  <h2>小课的运行引擎（Pi）</h2>
                  <p>
                    服务器启动时会自动在本机 PATH 中查找并验证
                    Pi，无需再手动配置连接器。找不到时会显示未连接；找到但不可用（如未配置
                    provider）会显示具体原因。
                  </p>
                  <Status
                    value={
                      s.health?.online && s.health?.acp ? 'complete' : 'queued'
                    }
                  />
                  {s.health?.acpError && (
                    <div className="feedback error">{s.health.acpError}</div>
                  )}
                  {s.health &&
                    !s.health.acp &&
                    !s.health.acpError &&
                    s.health.acpFound === false && (
                      <div className="feedback">
                        未在本机 PATH 找到 pi，请先安装
                        Pi；安装后服务器会在一分钟内自动识别。
                      </div>
                    )}
                  <p className="muted">
                    仅 Cloudflare Sites
                    部署需要配置连接器；自托管服务器会自动发现本机 Pi。
                  </p>
                  <div className="button-row">
                    <Button onClick={() => open('pair')}>
                      <Plus size={15} />
                      生成连接凭据
                    </Button>
                    <a
                      className="file-link"
                      href="/course-loop-connector.zip"
                      download
                    >
                      <Download size={14} />
                      下载连接器
                    </a>
                    <a
                      className="file-link"
                      href="/connector-guide.txt"
                      download
                    >
                      <Download size={14} />
                      连接说明
                    </a>
                  </div>
                  {token && (
                    <div className="token-box">
                      <strong>仅在本页显示，请保存到连接器配置</strong>
                      <code>{token}</code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cp(token)}
                      >
                        复制凭据
                      </Button>
                    </div>
                  )}
                  <div className="notice">
                    <ShieldCheck size={16} />
                    <span>
                      每个评分任务使用独立目录。学生代码应在你配置的隔离环境运行。
                    </span>
                  </div>
                </section>
                <section className="panel settings-card">
                  <div className="agent-symbol">
                    <Mail size={23} />
                  </div>
                  <h2>邮箱注册与邀请</h2>
                  <p>
                    服务器通过配置的 SMTP 服务发送登录验证码和 Team
                    邀请。未配置时，网站会明确提示，验证码不会假装已发送。
                  </p>
                  <Status
                    value={
                      s.health?.online && s.health?.mail ? 'complete' : 'queued'
                    }
                  />
                  {s.health?.mailError && (
                    <div className="feedback error">{s.health.mailError}</div>
                  )}
                  <p className="muted">
                    教师注册时自选身份；课程管理员由部署时配置的管理员邮箱决定。
                  </p>
                </section>
                <section className="panel data-panel">
                  <h2>小课工作日志</h2>
                  {!logData.items.length ? (
                    <p className="muted py-4">
                      还没有任务记录。与小课对话或学生提交作业后，任务会出现在这里。
                    </p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead>任务</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>耗时</TableHead>
                            <TableHead>说明</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {logData.items.map((j: Any) => (
                            <TableRow key={j.id}>
                              <TableCell>{fmt(j.created)}</TableCell>
                              <TableCell>
                                {jobKindNames[j.kind] || j.kind}
                              </TableCell>
                              <TableCell>
                                <Status value={j.status} />
                              </TableCell>
                              <TableCell>
                                {j.finished
                                  ? Math.max(
                                      1,
                                      Math.round(
                                        (j.finished - j.created) / 1000,
                                      ),
                                    ) + ' 秒'
                                  : '—'}
                              </TableCell>
                              <TableCell className="muted">
                                {j.error
                                  ? j.error.slice(0, 80)
                                  : j.attempts > 1
                                    ? `第 ${j.attempts} 次尝试`
                                    : ''}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="log-pager">
                        <span className="muted">
                          共 {logData.total} 条 · 第 {logData.page} /{' '}
                          {Math.max(
                            1,
                            Math.ceil(logData.total / logData.pageSize),
                          )}{' '}
                          页
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={logData.page <= 1}
                          onClick={() => setLogPage((p) => p - 1)}
                        >
                          上一页
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            logData.page >=
                            Math.ceil(logData.total / logData.pageSize)
                          }
                          onClick={() => setLogPage((p) => p + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            ) : teacher ? (
              !cls ? (
                noClass
              ) : (
                <div className="settings-grid">
                  <section className="panel settings-card">
                    <div className="agent-symbol">
                      <GraduationCap size={23} />
                    </div>
                    <h2>{cls.name}</h2>
                    <p>
                      {cls.courseTitle} · {cls.term}
                    </p>
                    <div className="button-row">
                      <Button
                        variant="outline"
                        onClick={() => cp(cls.joinCode)}
                      >
                        <Copy size={15} />
                        课堂邀请码：{cls.joinCode}
                      </Button>
                    </div>
                    <p>
                      小组最多 {cls.maxSize} 人 · 每实验正式提交最多 3
                      次，取最高分计成绩
                    </p>
                    <p>
                      截止时间：
                      {cls.deadline ? fmt(cls.deadline) : '未设置'}
                    </p>
                    <p>
                      自动发布：
                      {cls.autoPublish ? '已启用' : '关闭，待校准后启用'}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        open('settings');
                        setForm({
                          maxSize: cls.maxSize,
                          deadline: cls.deadline
                            ? new Date(
                                cls.deadline -
                                  new Date().getTimezoneOffset() * 60000,
                              )
                                .toISOString()
                                .slice(0, 16)
                            : '',
                          autoPublish: !!cls.autoPublish,
                        });
                      }}
                    >
                      修改课堂规则
                    </Button>
                  </section>
                </div>
              )
            ) : (
              <Empty title="课堂设置" body="请使用教师邮箱登录。">
                <Button onClick={() => open('login')}>邮箱登录</Button>
              </Empty>
            ))}
          {!loaded && (
            <p className="muted" role="status">
              正在连接工作空间…
            </p>
          )}
          <footer className="workspace-footer">
            <span>先定义标准，再验证成果。</span>
            <span>练习反馈 / 正式核验 / 可追溯评分</span>
          </footer>
        </main>
      </SidebarInset>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v && !busy && modal?.type !== 'profile') setModal(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>
              {
                (
                  {
                    login: '邮箱登录 / 注册',
                    profile: '完善个人信息',
                    newCourse: '新建课程',
                    delCourse: '删除课程',
                    delFile: '删除课程素材',
                    newClass: '开设课堂',
                    join: '加入课堂',
                    createTeam: '创建 Team',
                    invite: '邀请同学加入',
                    teamConfirm: '确认成员变更',
                    publish: '确认发布课程',
                    formal: '确认正式提交',
                    answer: '个人理解核验',
                    appeal: '对评分提出申诉',
                    review: '复核与成绩发布',
                    pair: '生成连接器凭据',
                    settings: '课堂规则',
                    repo: 'GitHub 仓库地址',
                    feedback: '提改进意见',
                  } as Any
                )[modal?.type]
              }
            </DialogTitle>
            <DialogDescription>
              {modal?.type === 'login'
                ? '使用你的邮箱获取验证码，首次登录验证后补充身份信息。'
                : modal?.type === 'profile'
                  ? '首次登录请补充你的身份信息，之后使用邮箱验证码即可直接登录。'
                  : modal?.type === 'formal'
                    ? detailIndividual
                      ? '本次将以你本人名义固定提交文件和评分规则。原版本不会被覆盖。'
                      : '本次将固定提交文件、评分规则和当前小组成员。原版本不会被覆盖。'
                    : modal?.type === 'publish'
                      ? '学生将看到以下草案版本。之后的修改进入新版本，不改变历史提交依据。'
                      : modal?.type === 'newClass'
                        ? '开设后生成课堂邀请码，学生凭码加入。'
                        : modal?.type === 'join'
                          ? '输入教师分享的课堂邀请码，加入后即可进行实验。'
                          : modal?.type === 'feedback'
                            ? '使用中遇到的问题或改进建议都会记录，课程负责人会定期查阅。'
                            : '提交前请核对内容。'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          {modal?.type === 'login' && (
            <>
              <label>
                邮箱
                <Input
                  autoComplete="email"
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => field('email', e.target.value)}
                />
              </label>
              <label>
                验证码
                <div className="button-row">
                  <Input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.code || ''}
                    onChange={(e) => field('code', e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const r = await call('auth/request', {
                          email: form.email,
                        });
                        setNotice(r.message);
                      })
                    }
                  >
                    获取验证码
                  </Button>
                </div>
              </label>
              {s.local && (
                <p className="muted">
                  当前为本地开发环境，验证码固定为{' '}
                  <strong className="dev-code">{s.devCode || '未配置'}</strong>
                  ，直接输入即可登录。
                </p>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await call('auth/verify', {
                      email: form.email,
                      code: form.code,
                    });
                    setSelected('');
                    if (r.user.role === 'pending') {
                      open('profile');
                      setNotice('验证成功，请完善身份信息');
                    } else {
                      setModal(null);
                      setView(defaultView[r.user.role] || 'courses');
                      setNotice('登录成功');
                    }
                  })
                }
              >
                验证并进入
              </Button>
            </>
          )}
          {modal?.type === 'profile' && (
            <>
              <label>
                身份
                <Select
                  value={form.role || 'student'}
                  onValueChange={(v) => field('role', String(v))}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) => (v === 'teacher' ? '教师' : '学生')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">学生</SelectItem>
                    <SelectItem value="teacher">教师</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label>
                姓名
                <Input
                  value={form.name || ''}
                  onChange={(e) => field('name', e.target.value)}
                />
              </label>
              {(form.role || 'student') === 'student' && (
                <label>
                  学号
                  <Input
                    value={form.studentNo || ''}
                    onChange={(e) => field('studentNo', e.target.value)}
                  />
                </label>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await call('auth/profile', {
                      role: form.role || 'student',
                      name: form.name,
                      studentNo:
                        (form.role || 'student') === 'student'
                          ? form.studentNo
                          : '',
                    });
                    setModal(null);
                    setSelected('');
                    setView(defaultView[r.user.role] || 'courses');
                    setNotice('信息已保存');
                  })
                }
              >
                保存并进入
              </Button>
            </>
          )}
          {modal?.type === 'newCourse' && (
            <>
              <label>
                课程名称
                <Input
                  placeholder="例如：新生实践"
                  value={form.title || ''}
                  onChange={(e) => field('title', e.target.value)}
                />
              </label>
              <label>
                学期
                <Input
                  placeholder="例如：2027 春季学期"
                  value={form.term || ''}
                  onChange={(e) => field('term', e.target.value)}
                />
              </label>
              <label>
                初始内容
                <Select
                  value={form.source || 'blank'}
                  onValueChange={(v) => field('source', String(v))}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) =>
                        v === 'copy'
                          ? '复制当前课程的实验内容'
                          : '空白起步（与小课对话生成）'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">
                      空白起步（与小课对话生成）
                    </SelectItem>
                    {course && (
                      <SelectItem value="copy">
                        复制当前课程的实验内容
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </label>
              <p className="muted">
                空白起步的课程没有实验内容，上传教学文档后与小课对话生成；发布前需完善实验与评分项。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await call('courses', {
                      source: form.source || 'blank',
                      copyId: form.source === 'copy' ? course?.id : undefined,
                      title: form.title || undefined,
                      term: form.term || undefined,
                    });
                    setSelected(r.id);
                    setModal(null);
                    setView('studio');
                  })
                }
              >
                创建课程
              </Button>
            </>
          )}
          {modal?.type === 'newClass' && (
            <>
              <label>
                选择课程
                <Select
                  value={form.courseId || ''}
                  onValueChange={(v) => field('courseId', String(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择一门课程">
                      {(v: string) => {
                        const c = s.courses?.find((x: Any) => x.id === v);
                        return c ? `${c.title} · ${c.term}` : '选择一门课程';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {s.courses?.map((c: Any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title} · {c.term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label>
                课堂名称
                <Input
                  placeholder="例如：软工 3 班"
                  value={form.name || ''}
                  onChange={(e) => field('name', e.target.value)}
                />
              </label>
              <Button
                disabled={busy || !form.courseId}
                onClick={() =>
                  act(async () => {
                    const r = await call('classes', {
                      courseId: form.courseId,
                      name: form.name || undefined,
                    });
                    setSelected(r.id);
                    setModal(null);
                    setNotice(`课堂已开设，课堂邀请码：${r.joinCode}`);
                  })
                }
              >
                开设课堂
              </Button>
            </>
          )}
          {modal?.type === 'join' && (
            <>
              <label>
                课堂邀请码
                <Input
                  value={form.code || ''}
                  onChange={(e) => field('code', e.target.value)}
                />
              </label>
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await call('join', { code: form.code });
                    setSelected(r.id);
                    setModal(null);
                    setView('courses');
                  })
                }
              >
                加入课堂
              </Button>
            </>
          )}
          {modal?.type === 'createTeam' && (
            <>
              <label>
                Team 名称
                <Input
                  placeholder="给你们的小组起个名字"
                  value={form.name || ''}
                  onChange={(e) => field('name', e.target.value)}
                />
              </label>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation('teams', { classId: s.selected, name: form.name })
                }
              >
                创建并担任组长
              </Button>
            </>
          )}
          {modal?.type === 'invite' && (
            <>
              <label>
                同学的邮箱
                <Input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => field('email', e.target.value)}
                />
              </label>
              <p className="muted">
                对方接受后才会加入。未注册同学可以使用此邮箱注册后接受邀请。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation(
                    'invite',
                    { teamId: modal.teamId, email: form.email },
                    '邀请已创建，对方可在网站接受；邮件按连接状态投递。',
                  )
                }
              >
                发出邀请
              </Button>
            </>
          )}
          {modal?.type === 'teamConfirm' && (
            <>
              <p>{modal.label}？历史提交的成员快照不会改变。</p>
              <Button
                disabled={busy}
                onClick={() => mutation('team-action', modal)}
              >
                确认变更
              </Button>
            </>
          )}
          {modal?.type === 'repo' && (
            <>
              <p className="muted">
                提交核验时会参考该仓库。留空保存可清除已设置的仓库地址。
              </p>
              <label>
                仓库地址
                <Input
                  placeholder="https://github.com/owner/repo"
                  value={form.repo || ''}
                  onChange={(e) => field('repo', e.target.value)}
                />
              </label>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation(
                    'team-repo',
                    { teamId: modal.teamId, repo: form.repo || '' },
                    '仓库地址已保存',
                  )
                }
              >
                保存
              </Button>
            </>
          )}
          {modal?.type === 'delCourse' && (
            <>
              <p>
                将删除 <strong>{modal.title}</strong>（{modal.term}
                ）及其草案、发布记录和课程素材，不可恢复。
              </p>
              <p className="muted">
                若已有老师基于这门课开设课堂，系统会拒绝删除。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await call('course-delete', { courseId: modal.courseId });
                    if (s.selected === modal.courseId) setSelected('');
                    setModal(null);
                    setNotice('课程已删除');
                  })
                }
              >
                确认删除
              </Button>
            </>
          )}
          {modal?.type === 'delFile' && (
            <>
              <p>
                将删除课程素材 <strong>{modal.name}</strong>
                ，下载链接将失效，不可恢复。
              </p>
              <p className="muted">
                小组与提交里的作业文件属于教学记录，不在此处删除。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation('file-delete', { id: modal.fileId }, '文件已删除')
                }
              >
                确认删除
              </Button>
            </>
          )}
          {modal?.type === 'publish' && (
            <>
              <div className="questions">
                <strong>本次变更</strong>
                {changes.map((name: string) => (
                  <p key={name}>{name}</p>
                ))}
                <p>已发布的历史版本和提交不受影响。</p>
              </div>
              <p>
                <strong>{draft.title}</strong> · v{course?.revision}
              </p>
              <ul className="publish-list">
                {draft.experiments.map((e: Any) => (
                  <li key={e.id}>
                    <Check size={15} />
                    {e.title}
                    <span>
                      {e.rubric.reduce((n: number, r: Any) => n + r.max, 0)} 分
                    </span>
                  </li>
                ))}
              </ul>
              {draft.questions?.length > 0 && (
                <p className="dialog-error">
                  还有 {draft.questions.length} 项待确认，请先回到对话补充。
                </p>
              )}
              <Button
                disabled={busy || !!draft.questions?.length}
                onClick={() =>
                  mutation(
                    'publish',
                    { courseId: s.selected, revision: course.revision },
                    '课程已发布，课堂可开始实验',
                  )
                }
              >
                确认发布这个版本
              </Button>
            </>
          )}
          {modal?.type === 'formal' && (
            <>
              <p>
                {detail?.title} · {detailIndividual ? s.user?.name : team?.name}
              </p>
              <p className="muted">
                {detailIndividual
                  ? '将以你本人名义提交，按你的提交记录计算次数与成绩。'
                  : `成员：${team?.members.map((m: Any) => m.name).join('、')}`}
              </p>
              <ul>
                {attachments.map((f) => (
                  <li key={f.id}>{f.name}</li>
                ))}
              </ul>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation(
                    'submit',
                    {
                      experimentId: detail.id,
                      mode: 'formal',
                      fileIds: attachments.map((f) => f.id),
                      note: message,
                    },
                    '正式提交已锁定，等待核验',
                  )
                }
              >
                锁定并提交
              </Button>
            </>
          )}
          {['answer', 'appeal'].includes(modal?.type) && (
            <>
              <textarea
                className="text-area"
                rows={7}
                aria-label={modal.type === 'answer' ? '个人回答' : '申诉理由'}
                value={form.content || ''}
                onChange={(e) => field('content', e.target.value)}
                placeholder={
                  modal.type === 'answer'
                    ? '逐题说明你的理解，引用你完成的具体文件或测试。'
                    : '指出评分项、具体证据及你认为需要复核的理由。'
                }
              />
              <Button
                disabled={busy}
                onClick={() =>
                  mutation(modal.type, {
                    submissionId: modal.submissionId,
                    content: form.content,
                  })
                }
              >
                提交
              </Button>
            </>
          )}
          {modal?.type === 'review' && (
            <>
              <label>
                复核理由
                <textarea
                  className="text-area"
                  value={form.reason || ''}
                  onChange={(e) => field('reason', e.target.value)}
                />
              </label>
              {modal.sub?.report?.items.map((i: Any) => (
                <label className="score-edit" key={i.id}>
                  {i.id}
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={form['score_' + i.id] ?? i.score}
                    onChange={(e) => field('score_' + i.id, e.target.value)}
                  />
                </label>
              ))}
              <p className="muted">
                调整将保留原始评分和本次理由；默认保留小课给出的证据。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation(
                    'grade-action',
                    {
                      submissionId: modal.sub.id,
                      appealId: modal.appealId,
                      reason: form.reason,
                      report: {
                        ...modal.sub.report,
                        items: modal.sub.report.items.map((i: Any) => ({
                          ...i,
                          score: Number(form['score_' + i.id] ?? i.score),
                        })),
                      },
                    },
                    '复核记录已保存，成绩已发布',
                  )
                }
              >
                保存并发布成绩
              </Button>
            </>
          )}
          {modal?.type === 'pair' && (
            <>
              <p>
                新凭据会使旧连接器凭据失效。模型账号和 SMTP
                密码只配置在你自己的连接器机器上。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await call('pair', {});
                    setToken(r.token);
                    setModal(null);
                  })
                }
              >
                生成新凭据
              </Button>
            </>
          )}
          {modal?.type === 'feedback' && (
            <>
              <textarea
                className="text-area"
                rows={6}
                aria-label="改进意见"
                value={form.content || ''}
                onChange={(e) => field('content', e.target.value)}
                placeholder="描述你遇到的问题或想改进的地方。"
              />
              <Button
                disabled={busy || !form.content?.trim()}
                onClick={() =>
                  mutation(
                    'feedback',
                    { content: form.content },
                    '意见已记录，课程负责人会查阅',
                  )
                }
              >
                提交意见
              </Button>
            </>
          )}
          {modal?.type === 'settings' && (
            <>
              <label>
                小组人数上限
                <Input
                  type="number"
                  min="1"
                  max="16"
                  value={form.maxSize || 4}
                  onChange={(e) => field('maxSize', e.target.value)}
                />
              </label>
              <label>
                正式提交截止时间
                <Input
                  type="datetime-local"
                  value={form.deadline || ''}
                  onChange={(e) => field('deadline', e.target.value)}
                />
              </label>
              <label className="switch-label">
                通过校准后自动发布正常成绩
                <Switch
                  checked={!!form.autoPublish}
                  onCheckedChange={(v) => field('autoPublish', v)}
                />
              </label>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation('class-settings', {
                    classId: s.selected,
                    maxSize: Number(form.maxSize),
                    deadline: form.deadline,
                    autoPublish: !!form.autoPublish,
                  })
                }
              >
                保存规则
              </Button>
            </>
          )}
          {modal?.type !== 'profile' && (
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                关闭
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <button
        className="assist-fab"
        aria-label="问小课"
        aria-expanded={assistOpen}
        onClick={() => setAssistOpen((o) => !o)}
      >
        <Sparkles size={19} />
        问小课
      </button>
      {assistOpen && (
        <div className="assist-panel" role="dialog" aria-label="小课助手">
          <header className="assist-head">
            <span className="assist-title">
              <Sparkles size={16} />
              小课助手
            </span>
            <span className="assist-actions">
              {s.user && (
                <button
                  className="assist-feedback-btn"
                  onClick={() => open('feedback')}
                >
                  提改进意见
                </button>
              )}
              <button
                className="assist-close"
                aria-label="关闭小课助手"
                onClick={() => setAssistOpen(false)}
              >
                <X size={16} />
              </button>
            </span>
          </header>
          {!s.user ? (
            <div className="assist-login">
              <p>
                你好，我是小课，课序平台的使用助手。登录后可以问我平台使用问题，也可以提交改进意见。
              </p>
              <Button size="sm" onClick={() => open('login')}>
                <Mail size={15} />
                邮箱登录
              </Button>
            </div>
          ) : (
            <>
              <div className="assist-messages" ref={assistScrollRef}>
                {!assistMsgs.length && (
                  <div className="assist-msg bot">
                    <p>
                      你好，我是小课。加入课堂、组队、提交实验或查看成绩有问题，都可以问我。
                    </p>
                  </div>
                )}
                {assistMsgs.map((m: Any) => (
                  <div
                    key={m.id}
                    className={
                      'assist-msg ' +
                      (m.role === 'user'
                        ? 'user'
                        : m.role === 'system'
                          ? 'system'
                          : 'bot')
                    }
                  >
                    <p>{m.content}</p>
                    {m.error && (
                      <button
                        className="assist-feedback-btn"
                        onClick={() => open('feedback')}
                      >
                        提改进意见
                      </button>
                    )}
                  </div>
                ))}
                {assistSending && (
                  <div className="assist-msg bot thinking">
                    <LoaderCircle size={14} className="spin" />
                    <p>小课思考中…</p>
                  </div>
                )}
              </div>
              <div className="assist-composer">
                <input
                  value={assistText}
                  onChange={(e) => setAssistText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.nativeEvent.isComposing &&
                      !e.shiftKey
                    ) {
                      e.preventDefault();
                      sendAssist();
                    }
                  }}
                  placeholder="向小课提问…"
                  aria-label="向小课提问"
                  disabled={assistSending}
                />
                <button
                  aria-label="发送"
                  disabled={assistSending || !assistText.trim()}
                  onClick={sendAssist}
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </SidebarProvider>
  );
}
