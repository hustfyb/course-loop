// 把 data/course-loop.sqlite（node-server 主库）全量同步到 vinext dev 的 miniflare D1 本地库，
// 保留目标库的 _cf_METADATA。用于预览模式（npm run dev）下数据与主库一致。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(
  root,
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'
);
const source = path.join(root, 'data/course-loop.sqlite');

const db = new DatabaseSync(target);
db.exec('PRAGMA busy_timeout=10000');
db.exec(`ATTACH DATABASE '${source.replaceAll("'", "''")}' AS src`);
db.exec('PRAGMA foreign_keys=OFF');
db.exec('BEGIN');
try {
  const objects = db
    .prepare(
      `SELECT type,name,tbl_name,sql FROM src.sqlite_master
       WHERE type IN ('table','index','trigger')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '\_cf\_%' ESCAPE '\\'
         AND name <> '__migrations'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`
    )
    .all()
    .map((r) => ({ ...r }));
  // 先清掉目标库里的同名业务对象
  const existing = db
    .prepare(
      `SELECT type,name FROM sqlite_master
       WHERE type IN ('table','index','trigger')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '\_cf\_%' ESCAPE '\\'
         AND name <> '__migrations'`
    )
    .all()
    .map((r) => ({ ...r }));
  for (const o of existing) {
    if (o.type === 'table') db.exec(`DROP TABLE IF EXISTS "${o.name}"`);
  }
  // 建表 + 导数据
  for (const o of objects.filter((x) => x.type === 'table')) {
    db.exec(o.sql);
    const cols = db
      .prepare(`SELECT name FROM src.pragma_table_info('${o.name.replaceAll("'", "''")}')`)
      .all()
      .map((c) => `"${c.name}"`)
      .join(',');
    db.exec(`INSERT INTO "${o.name}" (${cols}) SELECT ${cols} FROM src."${o.name}"`);
    console.log(`synced table ${o.name}`);
  }
  // 索引与触发器
  for (const o of objects.filter((x) => x.type !== 'table' && x.sql)) {
    db.exec(o.sql);
  }
  db.exec('COMMIT');
  console.log('done');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
} finally {
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('DETACH DATABASE src');
}
