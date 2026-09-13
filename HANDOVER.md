# 课序（course-loop）项目交接与维护指南

> 给下一个会话/维护者：先读这份，再读 README。本文不含密钥（密钥见 .dev.vars 与 connector/config.json，均不进 git）。

## 这是什么

面向软件工程课程的实验评分网站：管理员（课程负责人）编排课程内容（与小课对话/上传文档），教师选课开设独立课堂（邀请码招生），学生凭课堂邀请码加入、组队或个人提交实验，AI Agent「小课」自动评分（百分制、按评分项给证据），教师复核发布成绩，学生可申诉/回答追问。另有全站使用助手（问小课）与意见管理。

## 架构地图

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 前端 | `app/workbench.tsx` | 单文件三角色工作台（admin/teacher/student + guest/pending），样式 `app/globals.css`，组件 `components/ui/`（shadcn 风格 + base-ui） |
| API | `lib/service.ts` | 单文件全部端点，运行时无关（`api(req, env)`），workerd 与 Node 共用 |
| 校验 | `lib/domain.ts` | 草案校验（每实验评分项合计 100、判分方式 grading）与评分报告校验 |
| 数据 | `db/schema.ts` + `drizzle/` | sqlite 表结构；迁移 0000–0005，启动时幂等补执行 |
| 自托管运行时 | `server/node-server.mjs` | **主运行方式**：node:http + node:sqlite（D1 兼容封装）+ `data/files/` 本地存储 + 幂等迁移 + 静态/SSR 服务 + Pi 扫描探测 + 进程内 runner + SMTP 直发 |
| Agent 执行 | `connector/pi-print.mjs` | pi 原生单发：`pi -p --mode json [--no-tools] @PROMPT.md`，NDJSON 解析 |
| 任务循环 | `connector/runner.mjs` | draft/grade/answer/email 队列执行，被 node-server 与 Cloudflare connector 共用 |
| Cloudflare 备选 | `connector/index.mjs`、`app/api/` | Sites/Workers 部署：Workers 不能 spawn，评分与邮件由本机 connector 轮询执行 |
| 测试 | `tests/service.test.mjs`、`tests/node-server.test.mjs`、`connector/tests/` | node --test + node:sqlite 内存库 + fixture（smart-pi/broken-pi） |

## 核心业务规则（勿踩）

- **角色**：admin（`ADMIN_EMAILS` 决定）/ teacher（注册自选，选课开课）/ student（凭课堂邀请码入课）。新用户先 email+验证码落 `pending`，补身份（学生必填学号）后才可用业务端点。
- **课程**：新建默认**空白**（可选复制当前课程）；草案经小课对话演进；发布生成不可变 release；只有无课堂的课程可删除；支持 JSON 导出/导入（仅管理员）。
- **课堂**：joinCode 唯一；规则 maxSize/deadline/autoPublish。
- **Team**：成员管理全归学生（组长邀请/转让/移除，教师只读）；组可维护 GitHub 仓库地址（`teams.repo`）。
- **判分**：实验级 `grading: team|individual`（缺省 team）；小组判分组长提交，个人判分学生本人提交（无需小组）。**正式提交每实验最多 3 次取最高分**（快照里 `isBest`）；练习不限次不计成绩。百分制。
- **提交快照不可改**；发布后的课程修改进新草案版本。
- **邮件**：Resend SMTP（`SMTP_*` 环境变量）；额度/限流失败时下次取码提示「今日额度已用完，明天再试」；example.com 会被 Resend 拒收（测试账号正常现象）。
- **Pi（小课）**：PATH 扫描 `pi`（或 `PI_COMMAND` 显式路径）；`PI_ARGS` 可选锁定 provider/model；每分钟探测，未安装→「未连接」，provider 未配置→「待配置」+原因；`--no-tools` 用于探测与网页助手；输出 JSON 用宽容提取（首尾说明文字/围栏）。

## 日常维护

```bash
npm run build && npm run serve   # 运行（7100）
npm run dev                       # 前端开发（vinext HMR，注意此模式无 Pi）
npm.cmd test                      # 主测试（改动后必跑）
cd connector && node --test tests/*.test.mjs
npm.cmd run typecheck && npm.cmd run build
```

- **数据就是 `data/`**：`data/course-loop.sqlite*` + `data/files/` —— 备份=停机复制该目录；迁移=整目录搬走。
- **改 schema**：改 `db/schema.ts` → `npx drizzle-kit generate` → **人工核对生成的 SQLite 重建 SQL**（曾误选旧表不存在的列）→ 重启自动应用；正式库数据会保留。
- **Windows 坑**：spawn `.cmd` 必须 `shell:true` 且 `windowsHide:true`；PATH 扫描用 `where.exe`；cmd 批处理按 ANSI 码页解析，中文路径要留意。
- **前端易踩**：FileList 是活对象（先 `Array.from` 再清空 input）；React 19 的 onChange 对文件选择不可靠，统一用 `NativeFileInput`（原生监听）；runner 多条任务循环不得共享客户端句柄（曾互相误杀）。
- **反代/隧道**：已支持 `x-forwarded-proto/host`；公网代理下 `LOCAL_DEV` 自动失效（验证码走真实邮件）。
- **秘密卫生**：`.dev.vars`、`connector/config.json`、`data/` 在 .gitignore；Resend API Key 曾在聊天中出现，建议定期轮换并同步到 `.dev.vars`。

## 测试账号（本地开发，验证码固定值见 .dev.vars 的 DEV_EMAIL_CODE）

- 管理员：ADMIN_EMAILS 里那个邮箱
- 教师：`teacher1@example.com`（软工 1 班，邀请码 9621EC5794）
- 学生：`student1@example.com`、`stu-a`~`stu-d@example.com`（火箭队/探索队）、`newbie@example.com`、`stu-f@example.com`（未入课）

## 已知待办/方向

- 「实验情况」视图（负责人提过，未展开设计）
- Cloudflare Sites 上线（需 ChatGPT 付费工作区；评分/邮件走 connector；注意订阅有效期与数据驻留）
- 意见管理里的学生建议（如拖拽上传）
- 旧 10 分制历史成绩与新百分制并存（有意保留）
