"use strict";
const express = require("express");
const { makeAuth } = require("./auth");
const { makeRate } = require("./rate");
const { TABLES } = require("./db");

const UPSERT = {
  upsert_apt: "apartments",
  upsert_booking: "bookings",
  upsert_expense: "expenses",
  upsert_cleaning: "cleaning",
  upsert_staff: "staff",
};
const DELETE = {
  delete_expense: "expenses",
  delete_cleaning: "cleaning",
};

// Ключи localStorage старой версии приложения → таблицы
const LOCAL_KEYS = { apts: "apartments", bookings: "bookings", expenses: "expenses", cleaning: "cleaning", staff: "staff" };

function createApp(repo, cfg) {
  const app = express();
  const getRate = cfg.getRate || makeRate(repo);
  const auth = makeAuth(cfg);
  const origins = new Set(cfg.allowedOrigins);

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use((req, res, next) => {
    const o = req.get("origin");
    if (o && (origins.has(o) || cfg.devNoAuth)) {
      res.set("Access-Control-Allow-Origin", o);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Telegram-Init-Data");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.get("/api/data", auth, async (req, res) => {
    const data = {};
    for (const t of TABLES) data[t] = repo.list(t);
    res.json({
      ok: true,
      data: {
        apartments: data.apartments, bookings: data.bookings, expenses: data.expenses,
        cleaning: data.cleaning, staff: data.staff,
        rate: await getRate(), ts: new Date().toISOString(),
      },
    });
  });

  app.post("/api/action", auth, (req, res) => {
    const { action, data, id } = req.body || {};
    try {
      if (UPSERT[action]) {
        if (!data || typeof data !== "object") return res.status(400).json({ ok: false, error: "data required" });
        return res.json({ ok: true, data: repo.upsert(UPSERT[action], data, req.actor) });
      }
      if (action === "delete_booking") return res.json({ ok: true, data: repo.deleteBooking(id, req.actor) });
      if (DELETE[action]) return res.json({ ok: true, data: repo.softDelete(DELETE[action], id, req.actor) });
      return res.status(400).json({ ok: false, error: "Unknown action: " + action });
    } catch (e) {
      console.error(action, e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  /*
   * Перенос данных, которые старое приложение держало только в памяти телефона.
   * - сырой снимок всегда сохраняется в raw_imports;
   * - у существующих записей заполняются только пустые поля;
   * - записи, которых на сервере никогда не было (не дошли до таблицы), добавляются;
   * - записи, удалённые на сервере, не воскрешаются.
   */
  app.post("/api/migrate-local", auth, (req, res) => {
    const body = req.body || {};
    try {
      const result = repo.transaction(() => {
        const r = { filled: {}, inserted: {}, skipped_deleted: {} };
        for (const [key, table] of Object.entries(LOCAL_KEYS)) {
          const rows = Array.isArray(body[key]) ? body[key] : [];
          r.filled[table] = 0; r.inserted[table] = 0; r.skipped_deleted[table] = 0;
          for (const row of rows) {
            if (!row || row.id === undefined || row.id === null || row.id === "") continue;
            const existing = repo.getRow(table, row.id);
            if (existing && existing.deleted_at) { r.skipped_deleted[table]++; continue; }
            if (existing) {
              if (repo.fillBlanks(table, row, req.actor + ":phone").filled.length) r.filled[table]++;
            } else if (looksReal(table, row)) {
              repo.upsert(table, row, req.actor + ":phone");
              r.inserted[table]++;
            }
          }
        }
        return r;
      });
      repo.saveRaw("phone-localStorage", req.actor, body, result);
      res.json({ ok: true, data: result });
    } catch (e) {
      console.error("migrate-local", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));
  return app;
}

function looksReal(table, row) {
  if (table === "bookings") return !!(row.check_in || row.gross_income || row.guest_name);
  if (table === "expenses") return !!row.booking_id && Number(String(row.amount).replace(",", ".")) > 0;
  if (table === "apartments") return !!row.apartment_name;
  if (table === "cleaning") return !!row.apartment_id;
  if (table === "staff") return !!row.name;
  return false;
}

module.exports = { createApp };
