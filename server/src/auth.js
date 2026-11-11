"use strict";
/*
 * Проверка Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
const crypto = require("crypto");

function verifyInitData(initData, botToken, maxAgeSec) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (maxAgeSec && (Date.now() / 1000 - authDate) > maxAgeSec) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

function makeAuth({ botToken, allowedIds, adminToken, devNoAuth }) {
  const allowed = new Set(allowedIds);
  return function auth(req, res, next) {
    if (devNoAuth) { req.actor = "dev"; return next(); }
    const bearer = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (adminToken && bearer && bearer.length === adminToken.length &&
        crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(adminToken))) {
      req.actor = "admin";
      return next();
    }
    const user = verifyInitData(req.get("x-telegram-init-data"), botToken, 30 * 24 * 3600);
    if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!allowed.has(String(user.id))) {
      return res.status(403).json({ ok: false, error: "forbidden", tg_id: user.id });
    }
    req.actor = "tg:" + user.id + (user.username ? ":" + user.username : "");
    next();
  };
}

module.exports = { verifyInitData, makeAuth };
