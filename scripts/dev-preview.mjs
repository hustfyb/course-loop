// 预览/本地运行入口：解析 --host/--port（Kimi Work 等预览工具会附加这些参数），
// 启动完整功能的 node-server（进程内 runner + Pi 扫描 + SMTP），服务于 dist 构建产物。
// 前端 HMR 开发请用 npm run dev:hmr（vinext dev，注意该模式无 Pi、使用独立的 D1 模拟库）。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('--port', process.env.PORT || 7100));
const host = arg('--host', '0.0.0.0');

const vars = path.join(root, '.dev.vars');
if (fs.existsSync(vars)) {
  try {
    process.loadEnvFile(vars);
  } catch (e) {
    console.error('加载 .dev.vars 失败：', e.message);
  }
}

const clientDir = path.join(root, 'dist', 'client');
if (!fs.existsSync(clientDir)) {
  console.error('前端尚未构建：请先运行 npm run build 生成 dist/client');
  process.exit(1);
}
// 源码比构建产物新时提醒，避免预览到旧界面（跳过 node_modules 等工作目录）
const collect = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'work') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx|css|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const newest = (dir) =>
  collect(dir).reduce((m, f) => Math.max(m, fs.statSync(f).mtimeMs), 0);
const srcNewest = Math.max(
  ...['app', 'lib', 'connector', 'server'].map((d) =>
    newest(path.join(root, d)),
  ),
);
const distNewest = newest(clientDir);
if (srcNewest > distNewest) {
  console.warn('提示：源码比 dist 新，预览的可能是旧界面；如需最新界面请先 npm run build。');
}

const { startServer } = await import('../server/node-server.mjs');
await startServer({ port, host });
