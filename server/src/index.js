"use strict";
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");
const { open } = require("./db");
const { createApp } = require("./app");
const { startBot } = require("./bot");

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
  const repo = open(cfg.dbFile);
  const app = createApp(repo, cfg);
  const server = app.listen(cfg.port, cfg.host, () => console.log(`✅ API on http://${cfg.host}:${cfg.port}`));

  let bot = null;
  if (cfg.botEnabled && cfg.botToken) bot = await startBot(cfg);

  const stop = (sig) => {
    console.log("Stopping:", sig);
    if (bot) bot.stop(sig);
    server.close(() => { repo.db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

main().catch((e) => { console.error(e); process.exit(1); });
