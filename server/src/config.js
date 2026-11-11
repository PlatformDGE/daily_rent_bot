"use strict";
const path = require("path");

function list(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function loadConfig(env = process.env) {
  const cfg = {
    port: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
    dbFile: env.DB_FILE || path.join(__dirname, "..", "data", "apartflow.db"),
    botToken: env.BOT_TOKEN || "",
    webappUrl: env.WEBAPP_URL || "https://platformdge.github.io/daily_rent_bot/",
    allowedIds: list(env.ALLOWED_TG_IDS),
    allowedOrigins: list(env.ALLOWED_ORIGINS || "https://platformdge.github.io"),
    adminToken: env.ADMIN_TOKEN || "",
    devNoAuth: env.DEV_NO_AUTH === "1",
    botEnabled: env.BOT_ENABLED !== "0",
  };
  if (cfg.devNoAuth && env.NODE_ENV === "production") {
    throw new Error("DEV_NO_AUTH=1 запрещён в production");
  }
  if (!cfg.devNoAuth && !cfg.botToken) throw new Error("BOT_TOKEN is required");
  if (!cfg.devNoAuth && !cfg.allowedIds.length) {
    console.warn("⚠️  ALLOWED_TG_IDS пуст — в приложение никто не сможет войти. Узнайте ID командой /myid в боте.");
  }
  return cfg;
}

module.exports = { loadConfig };
