// 网页作业实评：抓取学生提供的网站地址，生成可核验的站点快照（Markdown）。
// 目的：网页分以"真实网站"为依据，而不是靠提交的源码或报告里的自述。
// 约束：只抓同一个 origin、最多 maxPages 页、资源抽查 maxAssets 个、整体有预算；任何异常都写进快照而不是抛错。
const UA = 'course-loop-grader/1.0 (+https://course-loop)';

function abs(u, base) {
  try {
    return new URL(u, base).href;
  } catch {
    return '';
  }
}
function sameOrigin(u, origin) {
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
}
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
function attrAll(html, tag, attr) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b[^>]*?\\b' + attr + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'gi');
  let m;
  while ((m = re.exec(html))) out.push(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 120) : '';
}
async function get(url, method = 'GET', timeout) {
  const r = await fetch(url, {
    method,
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
    signal: AbortSignal.timeout(timeout),
  });
  const ct = r.headers.get('content-type') || '';
  let body = '';
  if (method === 'GET' && /html|text|xml/i.test(ct)) body = (await r.text()).slice(0, 200000);
  return { status: r.status, ct, body, finalUrl: r.url || url };
}

export async function crawlSite(siteUrl, opts = {}) {
  const maxPages = opts.maxPages ?? 8;
  const maxAssets = opts.maxAssets ?? 40;
  const timeout = opts.timeout ?? 8000;
  const budgetMs = opts.budgetMs ?? 45000;
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);

  let base;
  try {
    base = new URL(siteUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('only http(s)');
  } catch {
    return `# 网站实评快照：抓取失败\n地址无效：${siteUrl}\n结论：无法访问该地址，网页相关评分只能按报告等其它材料进行，needsReview 应为 true。`;
  }
  const origin = base.origin;

  const home = await (async () => {
    try {
      return await get(base.href, 'GET', timeout);
    } catch (e) {
      return { status: 0, ct: '', body: '', finalUrl: base.href, error: String(e?.message || e).slice(0, 120) };
    }
  })();

  const pages = [{ url: base.href, status: home.status, error: home.error || '', html: home.body }];
  const assets = new Map();
  const seen = new Set([base.href, home.finalUrl].filter(Boolean));

  // 从已抓页面里收集站内链接（决定还要抓哪些页）与资源
  const detail = pages.map((p) => {
    const html = p.html || '';
    const links = attrAll(html, 'a', 'href').map((h) => abs(h, p.url)).filter(Boolean);
    const internal = links.filter((l) => sameOrigin(l, origin));
    const external = links.filter((l) => !sameOrigin(l, origin));
    const absoluteInternal = attrAll(html, 'a', 'href').filter((h) => /^https?:\/\//i.test(h) && sameOrigin(h, origin));
    const res = [
      ...attrAll(html, 'img', 'src'),
      ...attrAll(html, 'link', 'href'),
      ...attrAll(html, 'script', 'src'),
    ]
      .map((h) => abs(h, p.url))
      .filter(Boolean);
    for (const r of res) if (sameOrigin(r, origin) && !assets.has(r)) assets.set(r, { from: p.url });
    return { ...p, text: stripTags(html), internal, external, res, absoluteInternal };
  });

  // 把还没抓过的站内页面排队（去掉锚点/媒体）
  for (const d of detail) {
    for (const l of d.internal) {
      const clean = l.split('#')[0];
      if (!/\.(html?|php|aspx?)$|\/$|^[^.]*$/i.test(clean)) continue;
      if (seen.has(clean)) continue;
      seen.add(clean);
    }
  }
  // 二次抓取：补上主页链接到但还没抓的页（受 maxPages 预算约束）
  const toFetch = [...seen].filter((u) => !detail.some((d) => d.url === u)).slice(0, maxPages - detail.length);
  for (const u of toFetch) {
    if (left() < 4000) break;
    try {
      const r = await get(u, 'GET', timeout);
      if (r.status >= 200 && r.status < 400) {
        const html = r.body;
        const links = attrAll(html, 'a', 'href').map((h) => abs(h, u)).filter(Boolean);
        const res = [...attrAll(html, 'img', 'src'), ...attrAll(html, 'link', 'href'), ...attrAll(html, 'script', 'src')]
          .map((h) => abs(h, u))
          .filter(Boolean);
        for (const x of res) if (sameOrigin(x, origin) && !assets.has(x)) assets.set(x, { from: u });
        detail.push({
          url: u,
          status: r.status,
          html,
          text: stripTags(html),
          title: titleOf(html),
          internal: links.filter((l) => sameOrigin(l, origin)),
          external: links.filter((l) => !sameOrigin(l, origin)),
          res,
          absoluteInternal: attrAll(html, 'a', 'href').filter((h) => /^https?:\/\//i.test(h) && sameOrigin(h, origin)),
        });
      } else detail.push({ url: u, status: r.status, html: '', text: '', internal: [], external: [], res: [], absoluteInternal: [] });
    } catch (e) {
      detail.push({ url: u, status: 0, error: String(e?.message || e).slice(0, 80), text: '', internal: [], external: [], res: [], absoluteInternal: [] });
    }
  }

  // 资源可用性抽查（同源，最多 maxAssets 个）
  const broken = [];
  const assetList = [...assets.keys()].slice(0, maxAssets);
  for (const a of assetList) {
    if (left() < 3000) break;
    try {
      const r = await get(a, 'HEAD', Math.min(timeout, 6000));
      if (r.status >= 400) broken.push({ url: a, status: r.status });
    } catch {
      broken.push({ url: a, status: 0 });
    }
  }

  const okPages = detail.filter((p) => p.status >= 200 && p.status < 400);
  const titles = detail.filter((p) => p.title).map((p) => p.title);
  const lines = [];
  lines.push(`# 网站实评快照：${base.href}`);
  lines.push(`抓取时间：${new Date(t0).toISOString().slice(0, 16).replace('T', ' ')}（同源抓取，最多 ${maxPages} 页 / ${maxAssets} 个资源）`);
  lines.push(`主页状态：${home.status || '连接失败'}${home.error ? '（' + home.error + '）' : ''}；可访问页面：${okPages.length}/${detail.length}`);
  if (titles.length) lines.push(`站点标题：${titles.join(' | ').slice(0, 300)}`);
  lines.push('');
  lines.push('## 页面清单（实际抓取结果）');
  for (const p of detail) {
    lines.push(`### ${p.url}`);
    lines.push(`- HTTP 状态：${p.status || '连接失败'}`);
    if (p.title) lines.push(`- 标题：${p.title}`);
    lines.push(`- 正文字数：${(p.text || '').length}`);
    if (p.text) lines.push(`- 正文摘要：${p.text.slice(0, 220)}`);
    lines.push(`- 站内链接：${(p.internal || []).length} 个（其中写成绝对路径 ${(p.absoluteInternal || []).length} 处）`);
    lines.push(`- 站外链接：${(p.external || []).length} 个`);
    lines.push(`- 页面内资源引用：${(p.res || []).length} 个（图/样式/脚本）`);
  }
  lines.push('');
  lines.push(`## 资源可用性（抽查 ${assetList.length}/${assets.size} 个同源资源）`);
  if (!assetList.length) lines.push('- 未发现同源资源引用');
  else if (!broken.length) lines.push(`- 抽查的 ${assetList.length} 个资源全部返回 2xx/3xx`);
  else {
    lines.push(`- **${broken.length} 个资源不可用（404/连接失败）**：`);
    for (const b of broken.slice(0, 20)) lines.push(`  - ${b.url} → ${b.status || '连接失败'}`);
  }
  lines.push('');
  lines.push('## 判定提示');
  lines.push(`- 主页能否打开：${home.status >= 200 && home.status < 400 ? '能' : '不能'}`);
  lines.push(`- 从主页可达的页数：${okPages.length}（含主页）`);
  lines.push(`- 页面里绝对路径引用（应为 0）：${detail.reduce((n, p) => n + (p.absoluteInternal || []).length, 0)} 处`);
  lines.push('- 以上均为实际抓取证据；抓不到的页面/资源不得假定为可用。');
  return lines.join('\n').slice(0, 20000);
}