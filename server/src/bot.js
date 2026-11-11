"use strict";
const { Telegraf, Markup } = require("telegraf");

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function createBot({ botToken, webappUrl, allowedIds }) {
  const bot = new Telegraf(botToken);
  const allowed = new Set(allowedIds);
  const openBtn = () => Markup.inlineKeyboard([[Markup.button.webApp("🏠 Открыть ApartFlow", webappUrl)]]);

  // Записываем в журнал, кто пишет боту — чтобы админ мог найти Telegram ID по нику
  bot.use((ctx, next) => {
    if (ctx.from) console.log(`[tg] from id=${ctx.from.id} username=@${ctx.from.username || "-"} name=${ctx.from.first_name || ""} allowed=${allowed.has(String(ctx.from.id))}`);
    return next();
  });

  bot.start((ctx) => {
    const name = esc(ctx.from?.first_name || "");
    if (!allowed.has(String(ctx.from?.id))) {
      return ctx.reply(
        `👋 Привет, ${name}!\n\nДоступ к ApartFlow закрыт. Передайте администратору ваш ID: <code>${ctx.from?.id}</code>`,
        { parse_mode: "HTML" });
    }
    return ctx.reply(
      `👋 Привет, ${name}!\n\n<b>ApartFlow</b> — учёт посуточной аренды в Тбилиси.\nНажмите кнопку ниже, чтобы открыть приложение:`,
      { parse_mode: "HTML", ...openBtn() });
  });

  bot.command("app", (ctx) => ctx.reply("Открыть приложение:", openBtn()));
  bot.command("myid", (ctx) => ctx.reply(`Ваш Telegram ID: <code>${ctx.from?.id}</code>`, { parse_mode: "HTML" }));
  bot.help((ctx) => ctx.reply(
    "<b>ApartFlow Bot</b>\n\n/start — запустить бота\n/app — открыть приложение\n/myid — узнать свой ID\n/help — помощь",
    { parse_mode: "HTML" }));

  bot.catch((err, ctx) => console.error("Bot error for update", ctx?.update?.update_id, err));
  return bot;
}

async function startBot(cfg) {
  const bot = createBot(cfg);
  bot.launch({ dropPendingUpdates: true }).catch((e) => console.error("Bot launch failed:", e.message));
  try {
    await bot.telegram.setChatMenuButton({
      menuButton: { type: "web_app", text: "ApartFlow", web_app: { url: cfg.webappUrl } },
    });
  } catch (e) {
    console.warn("setChatMenuButton:", e.message);
  }
  console.log("✅ Bot started");
  return bot;
}

module.exports = { createBot, startBot };
