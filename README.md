# 课序 · AI 实验工作台

面向《软件工程 3.0》的文档驱动课程维护、邮箱注册、Team 协作与实验评分网站。教师上传文档，与 Pi 对话完善草案，确认后发布；学生按 Team 提交练习/正式版本。Agent 按 rubric 输出有证据的分项评价，网站校验及计算成绩。

## 当前结构

- `app/workbench.tsx`：教师/学生工作台、实验预览、Team、提交报告、设置及对话。
- `lib/service.ts`：D1/R2 API、邮箱码与会话、邀请和小组约束、版本发布、Agent 队列、成绩及申诉。
- `lib/seed.ts`：四次实验的任务、提交清单和评分项；非写死的四个业务分支。
- `db/schema.ts`、`drizzle/`：数据库结构与迁移。
- `connector/`：独立 Node 进程，SMTP 邮件与 Pi ACP stdio 连接。
- `public/materials/`：原始课程素材压缩包，教学留空和故意 bug 保留。

## 本地启动

需要 Node.js >=22.13、npm。运行 `npm ci`，复制 `.env.example` 为 `.dev.vars`（仅本地）。默认开发管理员邮箱为 hustfyb@gmail.com；开发验证码仅用于 localhost 测试，不投递邮件，不得带到生产。

首次迁移：

```
npx wrangler d1 execute DB --config=.openai/dev-wrangler.json --local --file=drizzle/0000_black_reavers.sql --persist-to=.wrangler/state --yes
npm run dev
```

后续新增迁移逐个按文件顺序执行，不重复创建现有表。开发服务器输出实际地址。

## 生产环境

Sites 使用 D1 `DB` 和 R2 `FILES`，应用源码保留 `.openai/hosting.json`。配置 `ADMIN_EMAILS=hustfyb@gmail.com`。生产禁止启用 `LOCAL_DEV` 与 `DEV_EMAIL_CODE`。平台可信身份且邮箱在管理员允许列表时，可直接进入教师空间；普通学生使用真实邮件验证码。

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
