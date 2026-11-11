"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { open } = require("../src/db");
const { createApp } = require("../src/app");

const BOT_TOKEN = "123456:TEST_TOKEN";
const ADMIN = "admin-secret-token";
let server, base, repo, tmp;

function initData(user, token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), query_id: "q1" });
  const dc = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dc).digest("hex"));
  return p.toString();
}

async function call(pathname, { body, headers = {} } = {}) {
  const r = await fetch(base + pathname, {
    method: body ? "POST" : "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json() };
}
const asAdmin = { Authorization: "Bearer " + ADMIN };

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apartflow-test-"));
  repo = open(path.join(tmp, "t.db"));
  const app = createApp(repo, {
    botToken: BOT_TOKEN, allowedIds: ["111"], adminToken: ADMIN,
    allowedOrigins: ["https://platformdge.github.io"], getRate: async () => 2.6,
  });
  await new Promise((res) => { server = app.listen(0, "127.0.0.1", res); });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => { server.close(); repo.db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("без авторизации — 401", async () => {
  assert.equal((await call("/api/data")).status, 401);
});

test("подделанный initData — 401, чужой пользователь — 403, свой — 200", async () => {
  const fake = initData({ id: 111 }, "999:OTHER");
  assert.equal((await call("/api/data", { headers: { "X-Telegram-Init-Data": fake } })).status, 401);
  const stranger = initData({ id: 222 });
  assert.equal((await call("/api/data", { headers: { "X-Telegram-Init-Data": stranger } })).status, 403);
  const ok = await call("/api/data", { headers: { "X-Telegram-Init-Data": initData({ id: 111, username: "david" }) } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.rate, 2.6);
});

test("устаревший initData (старше 30 дней) — 401", async () => {
  const old = initData({ id: 111 }, BOT_TOKEN, Math.floor(Date.now() / 1000) - 31 * 24 * 3600);
  assert.equal((await call("/api/data", { headers: { "X-Telegram-Init-Data": old } })).status, 401);
});

test("частичное обновление не стирает другие поля; доля платформы всегда 20", async () => {
  await call("/api/action", { headers: asAdmin, body: { action: "upsert_booking", data: { id: "b1", guest_name: "Ann", gross_income: "425,44", platform_pct: 35, check_in: "2026-06-06T00:00:00" } } });
  await call("/api/action", { headers: asAdmin, body: { action: "upsert_booking", data: { id: "b1", paid_out: "TRUE" } } });
  const b = repo.list("bookings").find((x) => x.id === "b1");
  assert.equal(b.guest_name, "Ann");
  assert.equal(b.gross_income, 425.44);
  assert.equal(b.platform_pct, 20);
  assert.equal(b.check_in, "2026-06-06");
  assert.equal(b.paid_out, true);
});

test("удаление проживания мягко удаляет и его расходы, данные остаются в базе", async () => {
  await call("/api/action", { headers: asAdmin, body: { action: "upsert_expense", data: { id: "e1", booking_id: "b1", amount: 10, currency: "GEL" } } });
  const r = await call("/api/action", { headers: asAdmin, body: { action: "delete_booking", id: "b1" } });
  assert.equal(r.json.data.expenses_deleted, 1);
  assert.equal(repo.list("bookings").length, 0);
  assert.equal(repo.list("expenses").length, 0);
  assert.ok(repo.getRow("bookings", "b1").deleted_at);
  assert.ok(repo.getRow("expenses", "e1").deleted_at);
});

test("перенос с телефона: заполняет пустые, не перезаписывает, добавляет недошедшие, не воскрешает удалённые", async () => {
  repo.upsert("bookings", { id: "b2", guest_name: "Server name", platform: "Airbnb", tax_pct: "" }, "t");
  const r = await call("/api/migrate-local", { headers: asAdmin, body: {
    bookings: [
      { id: "b2", guest_name: "Phone name", tax_pct: 1, income_currency: "USD", booking_fee: "" },
      { id: "b3", guest_name: "Never synced", check_in: "2026-11-01" },
      { id: "b1", guest_name: "Deleted on server" },
    ],
    expenses: [{ id: "e9", booking_id: "b3", amount: "12,5", currency: "GEL" }, { id: "e10", booking_id: "b3", amount: "" }],
    apts: [], cleaning: [], staff: [],
  } });
  assert.equal(r.status, 200);
  const b2 = repo.list("bookings").find((x) => x.id === "b2");
  assert.equal(b2.guest_name, "Server name");
  assert.equal(b2.tax_pct, 1);
  assert.equal(b2.income_currency, "USD");
  assert.ok(repo.list("bookings").find((x) => x.id === "b3"));
  assert.ok(repo.getRow("bookings", "b1").deleted_at, "удалённое не воскресло");
  assert.equal(repo.list("expenses").find((x) => x.id === "e9").amount, 12.5);
  assert.equal(repo.list("expenses").find((x) => x.id === "e10"), undefined, "пустой черновик не добавлен");
  assert.deepEqual(r.json.data.inserted.bookings, 1);
  const raw = repo.db.prepare("SELECT COUNT(*) n FROM raw_imports WHERE source='phone-localStorage'").get().n;
  assert.equal(raw, 1, "сырой снимок сохранён");
});

test("CORS: разрешён только наш origin", async () => {
  const ok = await fetch(base + "/api/health", { headers: { Origin: "https://platformdge.github.io" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://platformdge.github.io");
  const bad = await fetch(base + "/api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("журнал изменений ведётся", () => {
  const n = repo.db.prepare("SELECT COUNT(*) n FROM audit_log").get().n;
  assert.ok(n >= 5);
});
