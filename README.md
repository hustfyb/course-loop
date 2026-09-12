# 课序 · AI 实验工作台

面向《软件工程 3.0》的文档驱动课程维护、邮箱验证码登录（首次登录后补全身份信息）、Team 协作与实验评分网站。管理员维护课程并与 Pi 对话完善草案、确认发布；教师基于已发布课程开设独立课堂；学生凭课堂邀请码加入课堂后按 Team 提交练习/正式版本。Agent 按 rubric 输出有证据的分项评价，网站校验及计算成绩。

## 角色与模型

- **管理员（admin）**：由 `ADMIN_EMAILS` 允许列表授权。创建并维护「课程」及其实验内容（草案对话、发布、课程素材）。
- **教师（teacher）**：首次邮箱登录后补全教师身份，从课程列表中选择一门课开设「课堂」。每个课堂相互独立，有独立的 10 位课堂邀请码、小组、提交与成绩；课程已发布内容对其只读。
- **学生（student）**：注册时不属于任何课堂，输入课堂邀请码加入具体课堂后，才进行该课堂的小组、提交、成绩与申诉活动。

「课程」是内容载体（draft/release/messages），「课堂」是教学实例（enrollments/teams/members/submissions，通过 classId 关联）。邀请码一律指课堂邀请码，课程本身不再有邀请码。

## 当前结构

- `app/workbench.tsx`：管理员/教师/学生三套工作台、实验预览、Team、提交报告、课堂设置及对话。
- `lib/service.ts`：D1/R2 API、邮箱码与会话、角色注册、课堂开设与加入、邀请和小组约束、版本发布、Agent 队列、成绩及申诉。
- `lib/seed.ts`：四次实验的任务、提交清单和评分项；非写死的四个业务分支。
- `db/schema.ts`、`drizzle/`：数据库结构与迁移（0001 引入 classes 表，courseId 归口到 classId）。
- `connector/`：独立 Node 进程，SMTP 邮件与 Pi ACP stdio 连接。
- `public/materials/`：原始课程素材压缩包，教学留空和故意 bug 保留。

## 本地启动

需要 Node.js >=22.13、npm。运行 `npm ci`，复制 `.env.example` 为 `.dev.vars`（仅本地）。默认开发管理员邮箱为 hustfyb@gmail.com；开发验证码仅用于 localhost 测试，不投递邮件，不得带到生产。

首次迁移：

```
npx wrangler d1 execute DB --config=.openai/dev-wrangler.json --local --file=drizzle/0000_black_reavers.sql --persist-to=.wrangler/state --yes
npx wrangler d1 execute DB --config=.openai/dev-wrangler.json --local --file=drizzle/0001_classes_model.sql --persist-to=.wrangler/state --yes
npm run dev
```

后续新增迁移逐个按文件顺序执行，不重复创建现有表。开发服务器输出实际地址。

0001 迁移会保留旧数据：为每门旧课程生成一个「默认课堂」（沿用旧邀请码与小组规则），旧选课、小组、提交与文件归入该课堂，旧教师用户转为管理员。已在 node:sqlite 上验证全新初始化与旧库搬迁（见 tests/service.test.mjs 迁移用例）；若本地库状态异常，删除 `.wrangler/state` 后按上面两条命令重建即可。

## 生产环境

Sites 使用 D1 `DB` 和 R2 `FILES`，应用源码保留 `.openai/hosting.json`。配置 `ADMIN_EMAILS=hustfyb@gmail.com`。生产禁止启用 `LOCAL_DEV` 与 `DEV_EMAIL_CODE`。平台可信身份且邮箱在管理员允许列表时，可直接进入管理员空间；教师与学生使用真实邮件验证码登录，首次登录后补全姓名、身份与学号。

连接器配置见 `public/connector-guide.txt`。Pi、SMTP 与执行隔离由部署方提供。私有 Sites 的平台访问限制可能阻止未登录学生或连接器访问；向全班开放时必须同时确认平台访问模式与应用邮箱认证。未验证真实 Pi/SMTP 前不宣称真实评分和邮件投递验收通过。

## 验证

```
node --test tests/service.test.mjs
cd connector
npm ci
npm test
```

接口测试使用内存 SQLite 和 R2 适配测试替身；ACP 测试使用显式 fixture，证明协议交互，不证明真实模型质量。发布前还需 `npm run build`、类型检查，以及真实 Agent/邮件连通验证。

## 规则与限制

正式快照不可修改。发布后的课程修改进入新草案。默认每实验最多两个正式版本，以最后确认版本为准；报告保留所有版本。首次发布成绩默认需教师校准后确认，可在设置中启用正常结果自动发布。

工作目录不是沙箱。不要在含个人资料或凭据的主机上无隔离执行学生程序；ACP 不提供隔离保障。Web 端不执行上传代码。学生问答只能证明回答与成果的一致性，不能可靠证明作者身份。

首版支持 PDF 文本提取、DOCX、Markdown、ZIP；扫描 PDF 需另行提供可读文本。正式核验必须保留无法验证的项目，不能将未执行的测试转述为已通过。
