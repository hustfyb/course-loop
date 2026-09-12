# 课序 · AI 实验工作台

面向《软件工程 3.0》的文档驱动课程维护、邮箱验证码登录（首次登录后补全身份信息）、Team 协作与实验评分网站。管理员维护课程并与 Pi 对话完善草案、确认发布；教师基于已发布课程开设独立课堂；学生凭课堂邀请码加入课堂后按 Team 提交练习/正式版本。Agent 按 rubric 输出有证据的分项评价，网站校验及计算成绩。

## 角色与模型

- **管理员（admin）**：由 `ADMIN_EMAILS` 允许列表授权。创建并维护「课程」及其实验内容（草案对话、发布、课程素材）。
- **教师（teacher）**：首次邮箱登录后补全教师身份，从课程列表中选择一门课开设「课堂」。每个课堂相互独立，有独立的 10 位课堂邀请码、小组、提交与成绩；课程已发布内容对其只读。
- **学生（student）**：注册时不属于任何课堂，输入课堂邀请码加入具体课堂后，才进行该课堂的小组、提交、成绩与申诉活动。

「课程」是内容载体（draft/release/messages），「课堂」是教学实例（enrollments/teams/members/submissions，通过 classId 关联）。邀请码一律指课堂邀请码，课程本身不再有邀请码。

## 当前结构

- `app/workbench.tsx`：管理员/教师/学生三套工作台、实验预览、Team、提交报告、课堂设置及对话。
- `server/node-server.mjs`：自托管 Node 服务器（主运行时）。node:sqlite 本地库 + 幂等迁移、本地文件目录、静态资源与构建产物页面渲染、启动时在 PATH 自动扫描 Pi（`pi-acp`）并探测、进程内任务 runner、SMTP 直发邮件。
- `lib/service.ts`：运行时无关的 API（邮箱码与会话、角色注册、课堂开设与加入、邀请和小组约束、版本发布、Agent 队列、成绩及申诉），同时被 Node 服务器与 Cloudflare 部署复用。
- `lib/seed.ts`：四次实验的任务、提交清单和评分项；非写死的四个业务分支。
- `db/schema.ts`、`drizzle/`：数据库结构与迁移（0001 引入 classes 表，courseId 归口到 classId）。
- `connector/`：备选接入方式（仅 Cloudflare Sites 部署需要）——独立 Node 进程轮询网站，SMTP 邮件与 Pi ACP stdio 连接；`connector/runner.mjs` 被 Node 服务器进程内复用。
- `public/materials/`：原始课程素材压缩包，教学留空和故意 bug 保留。

## 本地启动（自托管，推荐）

需要 Node.js >=22.13、npm。运行 `npm ci`，复制 `.env.example` 为 `.dev.vars`（仅本地）。默认开发管理员邮箱为 hustfyb@gmail.com；开发验证码仅用于 localhost 测试，不投递邮件，不得带到生产。

```
npm run build
npm run serve
```

`npm run serve` 启动 `server/node-server.mjs`（默认端口 7100，`PORT` 可改）：自动建 `data/` 目录并按序执行 `drizzle/*.sql` 幂等迁移，无需手动跑 wrangler 迁移。启动日志打印端口、数据目录、Pi 扫描结果与 SMTP 状态（不打印凭据）。

### Pi（Agent）接入

服务器启动时及每 60 秒在本机 PATH 自动扫描 `pi-acp`（Windows 用 `where.exe`），扫描到后主动发探针问题验证配置：

- **已安装且配置可用**：顶部显示「Pi 已连接」，任务由服务器进程内直接执行，无需任何手动配置。
- **未安装**：显示「Pi 未连接」，Agent 类任务留在队列等待；安装后一分钟内自动接入。
- **已安装但不可用**（如未配置 provider）：显示「Pi 待配置」及具体原因（设置页同步显示错误文本）。
- 也可用环境变量 `PI_COMMAND` 显式指定 pi-acp 路径，跳过扫描。

设置页里的「生成连接凭据 / 下载连接器 / 连接说明」仅 Cloudflare Sites 部署需要；自托管模式下的 pair 凭据由服务器启动时自动生成并覆盖写入。

### 邮件（SMTP）

自托管模式由服务器进程内经 nodemailer 直发，配置以下环境变量（写入 `.dev.vars` 或系统环境）：

```
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=teacher@example.com
SMTP_PASS=SMTP 授权码
SMTP_FROM=课序 <teacher@example.com>
```

未配置 `SMTP_HOST` 时邮件功能离线：设置页显示提示，验证码与邀请邮件任务留在队列不投递。

### 前端开发

改前端时仍可用 `npm run dev`（vinext dev）；但完整 Agent/邮件链路需走 `npm run build && npm run serve`。

## 生产环境

### 自托管（主运行时）

`npm run build && npm run serve`。`npm start` 等价于 `npm run serve`（需先 build）。数据保存在 `data/`（已 gitignore）；`.dev.vars` 存在时自动加载，也可用系统环境变量。支持 `PORT`、`ADMIN_EMAILS`、`LOCAL_DEV`、`DEV_EMAIL_CODE`、`SMTP_*`、`PI_COMMAND`。

### Cloudflare Sites（备选）

Sites 使用 D1 `DB` 和 R2 `FILES`，应用源码保留 `.openai/hosting.json`。本地预览该运行时用 `npm run start:cf`（wrangler）。配置 `ADMIN_EMAILS=hustfyb@gmail.com`。生产禁止启用 `LOCAL_DEV` 与 `DEV_EMAIL_CODE`。平台可信身份且邮箱在管理员允许列表时，可直接进入管理员空间；教师与学生使用真实邮件验证码登录，首次登录后补全姓名、身份与学号。

此部署方式下 Agent 与邮件由独立连接器（`connector/`）轮询网站完成：教师从设置页生成连接凭据，填入连接器 `config.json` 后运行 `npm start`（connector 目录内）。连接器配置见 `public/connector-guide.txt`。Pi、SMTP 与执行隔离由部署方提供。私有 Sites 的平台访问限制可能阻止未登录学生或连接器访问；向全班开放时必须同时确认平台访问模式与应用邮箱认证。未验证真实 Pi/SMTP 前不宣称真实评分和邮件投递验收通过。

Cloudflare 本地 D1 首次迁移（仅 `start:cf` 方式需要）：

```
npx wrangler d1 execute DB --config=.openai/dev-wrangler.json --local --file=drizzle/0000_black_reavers.sql --persist-to=.wrangler/state --yes
npx wrangler d1 execute DB --config=.openai/dev-wrangler.json --local --file=drizzle/0001_classes_model.sql --persist-to=.wrangler/state --yes
```

后续新增迁移逐个按文件顺序执行，不重复创建现有表。0001 迁移会保留旧数据：为每门旧课程生成一个「默认课堂」（沿用旧邀请码与小组规则），旧选课、小组、提交与文件归入该课堂，旧教师用户转为管理员。已在 node:sqlite 上验证全新初始化与旧库搬迁（见 tests/service.test.mjs 迁移用例）；若本地库状态异常，删除 `.wrangler/state` 后按上面两条命令重建即可。

## 验证

```
npm test          # service + node-server + connector 全部测试
cd connector
npm ci
npm test
```

接口测试使用内存 SQLite 和 R2 适配测试替身；`tests/node-server.test.mjs` 使用临时目录、假 pi-acp 与智能 ACP fixture 做端到端验证（建课→发布→入课→建队→上传→练习提交→满分报告），证明协议与队列交互，不证明真实模型质量。发布前还需 `npm run build`、`npm run typecheck`，以及真实 Agent/邮件连通验证。

## 规则与限制

正式快照不可修改。发布后的课程修改进入新草案。默认每实验最多两个正式版本，以最后确认版本为准；报告保留所有版本。首次发布成绩默认需教师校准后确认，可在设置中启用正常结果自动发布。

Team 成员管理由学生自行负责：组长邀请/撤销邀请/转让组长/移除组员，组员可退出，组长退出前须先转让；教师与管理员不干预成员。正式提交保留成员快照但不再锁定成员，提交后仍可调整。每个 Team 可维护自己的 GitHub 仓库地址，组员可设置、修改或清空。

工作目录不是沙箱。不要在含个人资料或凭据的主机上无隔离执行学生程序；ACP 不提供隔离保障。Web 端不执行上传代码。学生问答只能证明回答与成果的一致性，不能可靠证明作者身份。

首版支持 PDF 文本提取、DOCX、Markdown、ZIP；扫描 PDF 需另行提供可读文本。正式核验必须保留无法验证的项目，不能将未执行的测试转述为已通过。
