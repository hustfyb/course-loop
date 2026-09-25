// 课序连接器（Cloudflare Sites 部署的备选接入方式）：读取 config.json 后调用 runner。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import nodemailer from 'nodemailer';
import {startRunner} from './runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await fs.readFile(process.env.COURSE_CONNECTOR_CONFIG||path.join(here,'config.json'),'utf8'));
const origin=new URL(config.siteUrl);if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('远程站点必须使用 HTTPS');
if(config.acp?.enabled&&!config.executionIsolated)throw Error('请先将连接器与 Pi 部署到隔离环境，并设置 executionIsolated=true。工作目录本身不是沙箱。');
const mail=config.smtp?.enabled?nodemailer.createTransport(config.smtp):null;
console.log('课序连接器启动。不会输出凭据、验证码或学生文件内容。');
const runner=startRunner({
 baseUrl:origin.origin,
 token:config.token,
 siteAccessToken:config.siteAccessToken||'',
 acp:config.acp?.enabled?{command:config.acp.command,args:config.acp.args||[]}:null,
 sendMail:mail?async(m)=>{await mail.sendMail({from:config.smtp.from,...m});}:null,
 workRoot:path.resolve(here,config.workRoot||'work'),
 pollIntervalMs:config.pollIntervalMs||5000,
 taskTimeoutMs:config.taskTimeoutMs||1200000,
});
process.on('SIGINT',()=>runner.stop());process.on('SIGTERM',()=>runner.stop());
await runner.done;
