"use strict";
/*
 * Резервная копия базы (безопасно на работающем сервере).
 *   node scripts/backup.js [папка]   — по умолчанию ./backups, хранится 30 последних
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "apartflow.db");
const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 30);

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(dir, `apartflow-${stamp}.db`);
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  await db.backup(out);
  db.close();
  const check = new Database(out, { readonly: true });
  const ok = check.pragma("integrity_check", { simple: true });
  const n = check.prepare("SELECT COUNT(*) AS n FROM bookings").get().n;
  check.close();
  if (ok !== "ok") throw new Error("integrity_check failed: " + ok);
  const files = fs.readdirSync(dir).filter((f) => /^apartflow-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(dir, f));
  console.log(`✅ ${out} (bookings: ${n})`);
})().catch((e) => { console.error(e); process.exit(1); });
