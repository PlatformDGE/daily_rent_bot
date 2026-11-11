"use strict";
/*
 * Приведение записей к единому виду перед сохранением.
 * Правило: ничего не выбрасываем — неизвестные поля сохраняются как есть.
 */

// Доля платформы фиксирована: платформа 20%, собственник 80%.
const PLATFORM_PCT = 20;

const NUMERIC = new Set([
  "gross_income", "amount", "booking_fee", "tax_pct", "nights",
  "total_amount", "hourly_rate", "total_hours",
]);
const DATE_ONLY = new Set(["check_in", "check_out", "date", "paid_out_at"]);
const ID_REFS = new Set(["id", "apartment_id", "booking_id"]);

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : String(v); // не число — сохраняем исходник, чтобы не потерять
}

function toDate(v) {
  if (v === "" || v === null || v === undefined) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function toBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return "";
}

function clean(table, input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (k.startsWith("_")) continue; // служебные поля клиента (_draft и т.п.)
    if (v === undefined) continue;
    if (NUMERIC.has(k)) out[k] = toNumber(v);
    else if (DATE_ONLY.has(k)) out[k] = toDate(v);
    else if (ID_REFS.has(k)) out[k] = v === "" || v === null ? "" : String(v).trim();
    else if (k === "paid_out" || k === "active") out[k] = toBool(v);
    else out[k] = v; // текст не трогаем (даже пробелы) — чтобы совпадали имена, напр. "Mike "
  }
  if (table === "bookings" || table === "apartments") {
    if ("platform_pct" in out || table === "bookings") out.platform_pct = PLATFORM_PCT;
  }
  return out;
}

function isBlank(v) {
  return v === undefined || v === null || v === "" ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
}

module.exports = { clean, isBlank, toNumber, toDate, PLATFORM_PCT };
