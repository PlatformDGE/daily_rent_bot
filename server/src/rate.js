"use strict";
/* Курс USD→GEL от Национального банка Грузии, кэш на 6 часов. */
const FALLBACK = 2.7;
const TTL_MS = 6 * 3600 * 1000;

async function fetchNBG() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
  const url = "https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json?date=" + today;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("NBG HTTP " + r.status);
  const data = await r.json();
  const usd = data?.[0]?.currencies?.find((c) => c.code === "USD");
  if (!usd?.rate) throw new Error("NBG: USD not found");
  return Number(usd.rate.toFixed(4));
}

function makeRate(repo) {
  return async function getRate() {
    const cached = repo.kvGet("usd_gel");
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.rate;
    try {
      const rate = await fetchNBG();
      repo.kvSet("usd_gel", { rate, ts: Date.now() });
      return rate;
    } catch (e) {
      console.warn("Rate fetch failed:", e.message);
      return cached ? cached.rate : FALLBACK;
    }
  };
}

module.exports = { makeRate };
