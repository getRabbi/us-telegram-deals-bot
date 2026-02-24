import fs from "node:fs";
import path from "node:path";
import { stripQuery } from "./utils.js";

export function loadState(fp) {
  try {
    const raw = fs.readFileSync(fp, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.posted) parsed.posted = [];
    return parsed;
  } catch {
    return { posted: [] };
  }
}

export function saveState(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

export function pruneOld(state, daysTtl) {
  const now = Date.now();
  const ttlMs = daysTtl * 24 * 60 * 60 * 1000;
  state.posted = (state.posted || []).filter((p) => now - p.ts < ttlMs);
}

export function dealKey(d) {
  const store = (d.storeTag || "").toLowerCase();
  const id = (d.id || d.asin || stripQuery(d.url || "")).toString().toLowerCase();
  const price = (d.now || "").toString().toLowerCase().replace(/\s+/g, "");
  return `${store}|${id}|${price}`.slice(0, 240);
}

export function hasPosted(state, deal) {
  const key = dealKey(deal);
  return (state.posted || []).some((p) => p.key === key);
}

export function rememberPosted(state, deal) {
  state.posted = state.posted || [];
  state.posted.push({ key: dealKey(deal), ts: Date.now() });
}
