"use strict";
/*
 * Перенос данных из Google Sheets (через старый Apps Script) в базу.
 *
 *   node scripts/import-sheets.js <файл.json | URL Apps Script>
 *
 * - Новые записи добавляются с исходными created_at/updated_at.
 * - У уже существующих записей заполняются только пустые поля (повторный запуск безопасен).
 * - Исходный снимок целиком сохраняется в raw_imports.
 * - В конце сверка: каждая запись источника есть в базе с теми же значениями.
 */
const fs = require("fs");
const path = require("path");
const { open, TABLES } = require("../src/db");
const { clean } = require("../src/normalize");

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src + (src.includes("?") ? "&" : "?") + "v=" + Date.now());
    return r.json();
  }
  return JSON.parse(fs.readFileSync(src, "utf8"));
}

const SRC_KEY = { apartments: "apartments", bookings: "bookings", expenses: "expenses", cleaning: "cleaning", staff: "staff" };

async function main() {
  const src = process.argv[2];
  if (!src) { console.error("Usage: node scripts/import-sheets.js <file.json|GAS url>"); process.exit(1); }
  const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "apartflow.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const repo = open(dbFile);
  const json = await load(src);
  if (!json.ok || !json.data) throw new Error("Источник вернул ошибку: " + JSON.stringify(json).slice(0, 200));
  const data = json.data;

  const stats = {};
  repo.transaction(() => {
    for (const t of TABLES) {
      const rows = data[SRC_KEY[t]] || [];
      stats[t] = { source: rows.length, created: 0, filled: 0, unchanged: 0 };
      for (const row of rows) {
        if (row.id === "" || row.id === undefined || row.id === null) throw new Error(`${t}: запись без id: ${JSON.stringify(row)}`);
        if (repo.getRow(t, row.id)) {
          const r = repo.fillBlanks(t, row, "import:sheets");
          r.filled.length ? stats[t].filled++ : stats[t].unchanged++;
        } else {
          repo.upsert(t, row, "import:sheets", { keepTimestamps: true });
          stats[t].created++;
        }
      }
    }
  });
  repo.saveRaw("google-sheets", "import:sheets", data, stats);

  // Сверка
  const problems = [];
  for (const t of TABLES) {
    for (const row of data[SRC_KEY[t]] || []) {
      const dbRow = repo.getRow(t, row.id);
      if (!dbRow) { problems.push(`${t}/${row.id}: нет в базе`); continue; }
      const stored = JSON.parse(dbRow.data);
      const expected = clean(t, row);
      for (const [k, v] of Object.entries(expected)) {
        if (k === "id" || k === "created_at" || k === "updated_at") continue;
        if (v === "" || v === null) continue; // пустые могли заполниться с телефона
        if (JSON.stringify(stored[k]) !== JSON.stringify(v)) problems.push(`${t}/${row.id}.${k}: ${JSON.stringify(v)} → ${JSON.stringify(stored[k])}`);
      }
    }
  }

  const bookingIds = new Set(repo.list("bookings").map((b) => b.id));
  const orphans = repo.list("expenses").filter((e) => !bookingIds.has(String(e.booking_id)));

  console.table(stats);
  console.log(`Расходов без проживания (сохранены, в приложении не видны): ${orphans.length}`);
  if (problems.length) {
    console.error("❌ Расхождения:\n" + problems.join("\n"));
    process.exit(2);
  }
  console.log("✅ Сверка пройдена: все записи из таблицы есть в базе без изменений.");
}

main().catch((e) => { console.error(e); process.exit(1); });
