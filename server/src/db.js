"use strict";
/*
 * Хранилище на SQLite.
 * Каждая сущность — таблица (id, data JSON, created_at, updated_at, deleted_at).
 * Удаление «мягкое»: запись помечается deleted_at и остаётся в базе.
 * Каждое изменение пишется в audit_log (было/стало).
 */
const Database = require("better-sqlite3");
const { clean, isBlank } = require("./normalize");

const TABLES = ["apartments", "bookings", "expenses", "cleaning", "staff"];

function open(file) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  for (const t of TABLES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, actor TEXT, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
    action TEXT NOT NULL, before TEXT, after TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS raw_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, source TEXT NOT NULL, actor TEXT, payload TEXT NOT NULL, result TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
  return new Repo(db);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

class Repo {
  constructor(db) {
    this.db = db;
  }

  check(table) {
    if (!TABLES.includes(table)) throw new Error("Unknown table: " + table);
  }

  getRow(table, id) {
    this.check(table);
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(String(id));
  }

  toObj(row) {
    return Object.assign(JSON.parse(row.data), {
      id: row.id, created_at: row.created_at, updated_at: row.updated_at,
    });
  }

  list(table) {
    this.check(table);
    return this.db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY created_at`)
      .all().map((r) => this.toObj(r));
  }

  audit(actor, entity, id, action, before, after) {
    this.db.prepare(`INSERT INTO audit_log (ts, actor, entity, entity_id, action, before, after)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      new Date().toISOString(), actor || null, entity, String(id), action,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
  }

  /* Вставка или обновление. Поля, которых нет во входных данных, сохраняются. */
  upsert(table, input, actor, opts = {}) {
    this.check(table);
    const data = clean(table, input);
    const id = String(data.id || genId());
    delete data.id;
    const createdIn = data.created_at; delete data.created_at;
    const updatedIn = data.updated_at; delete data.updated_at;
    const now = new Date().toISOString();
    const row = this.getRow(table, id);
    if (row) {
      const before = JSON.parse(row.data);
      const after = Object.assign({}, before, data);
      if (JSON.stringify(before) === JSON.stringify(after) && !row.deleted_at) return { id, changed: false };
      this.db.prepare(`UPDATE ${table} SET data = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`)
        .run(JSON.stringify(after), opts.keepTimestamps && updatedIn ? updatedIn : now, id);
      this.audit(actor, table, id, row.deleted_at ? "restore" : "update", before, after);
      return { id, changed: true };
    }
    this.db.prepare(`INSERT INTO ${table} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, JSON.stringify(data),
        (opts.keepTimestamps && createdIn) || now,
        (opts.keepTimestamps && updatedIn) || now);
    this.audit(actor, table, id, "create", null, data);
    return { id, changed: true, created: true };
  }

  /* Заполняет только пустые поля существующей записи — ничего не перезаписывает. */
  fillBlanks(table, input, actor) {
    this.check(table);
    const data = clean(table, input);
    const id = String(data.id);
    const row = this.getRow(table, id);
    if (!row) return { id, filled: [] };
    const before = JSON.parse(row.data);
    const after = Object.assign({}, before);
    const filled = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === "id" || k === "created_at" || k === "updated_at") continue;
      if (isBlank(after[k]) && !isBlank(v)) { after[k] = v; filled.push(k); }
    }
    if (!filled.length) return { id, filled };
    this.db.prepare(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(after), new Date().toISOString(), id);
    this.audit(actor, table, id, "fill_blanks", before, after);
    return { id, filled };
  }

  softDelete(table, id, actor) {
    this.check(table);
    const row = this.getRow(table, id);
    if (!row || row.deleted_at) return { deleted: null };
    this.db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), String(id));
    this.audit(actor, table, id, "delete", JSON.parse(row.data), null);
    return { deleted: String(id) };
  }

  /* Удаление проживания вместе с его расходами (тоже мягко). */
  deleteBooking(id, actor) {
    return this.db.transaction(() => {
      const res = this.softDelete("bookings", id, actor);
      const exps = this.db.prepare(`SELECT id FROM expenses WHERE deleted_at IS NULL AND json_extract(data, '$.booking_id') = ?`).all(String(id));
      for (const e of exps) this.softDelete("expenses", e.id, actor);
      return Object.assign(res, { expenses_deleted: exps.length });
    })();
  }

  saveRaw(source, actor, payload, result) {
    this.db.prepare(`INSERT INTO raw_imports (ts, source, actor, payload, result) VALUES (?, ?, ?, ?, ?)`)
      .run(new Date().toISOString(), source, actor || null, JSON.stringify(payload), result ? JSON.stringify(result) : null);
  }

  kvGet(k) {
    const r = this.db.prepare(`SELECT v FROM kv WHERE k = ?`).get(k);
    return r ? JSON.parse(r.v) : null;
  }

  kvSet(k, v) {
    this.db.prepare(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(k, JSON.stringify(v));
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = { open, TABLES };
