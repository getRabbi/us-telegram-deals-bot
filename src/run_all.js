import path from "node:path";
import {
  loadState,
  saveState,
  pruneOld,
  hasPosted,
  rememberPosted
} from "./state.js";
import { sendPhotoPost, sendTextPost } from "./telegram.js";
import { formatDealCard } from "./formatPost.js";
import { affiliateUrl } from "./affiliate.js";
import {
  sleep,
  calcDiscountPct,
  priceToNumber,
  stripQuery,
  sanitizePrices,
  scoreDeal
} from "./utils.js";

import { fetchAmazon } from "./stores/amazon.js";
import { fetchWalmart } from "./stores/walmart.js";
import { fetchBestBuy } from "./stores/bestbuy.js";
import { fetchTarget } from "./stores/target.js";
import { fetchHomeDepot } from "./stores/homedepot.js";
import { fetchSlickdeals } from "./stores/slickdeals.js";
import { fetchLocalFallback } from "./stores/localFallback.js";

// ---------------- config ----------------

const MAX_TOTAL = Number(process.env.MAX_POSTS_TOTAL || 15);
const MAX_PER_STORE = Number(process.env.MAX_POSTS_PER_STORE || 4);
const MIN_DAILY = Number(process.env.MIN_POSTS_DAILY || 10);

const DAYS_TTL = Number(process.env.DAYS_TTL || 7);
const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS || 4500);

// strict preference (but never blocks daily posting)
const STRICT_MIN_DISCOUNT = Number(process.env.STRICT_MIN_DISCOUNT || 20);
const STRICT_MIN_PRICE = Number(process.env.STRICT_MIN_PRICE || 120);
const FALLBACK_MODE = String(process.env.FALLBACK_MODE || "1") === "1";

const POSTED_PATH = path.join(process.cwd(), "data", "posted.json");

// ---------------- helpers ----------------

function strictOk(d) {
  const pct = Number(d.discountPct || 0);
  const nowNum = priceToNumber(d.now);
  return pct >= STRICT_MIN_DISCOUNT && nowNum >= STRICT_MIN_PRICE;
}

function browseMoreUrl(tag) {
  switch (tag) {
    case "AMAZONUS":
      return "https://www.amazon.com/gp/goldbox";
    case "WALMART":
      return "https://www.walmart.com/cp/deals/5438";
    case "BESTBUY":
      return "https://www.bestbuy.com/site/electronics/deals/abcat0500000.c?id=abcat0500000";
    case "TARGET":
      return "https://www.target.com/c/deals/-/N-4xw74";
    case "HOMEDEPOT":
      return "https://www.homedepot.com/SpecialBuy/SpecialBuyOfTheDay";
    case "SLICKDEALS":
      return "https://slickdeals.net/deals/";
    default:
      return "https://slickdeals.net/deals/";
  }
}

function classifyByUrl(u) {
  const s = String(u || "").toLowerCase();
  if (s.includes("amazon.com")) return { tag: "AMAZONUS", store: "Amazon US", hashtag: "#Amazon" };
  if (s.includes("walmart.com")) return { tag: "WALMART", store: "Walmart", hashtag: "#Walmart" };
  if (s.includes("bestbuy.com")) return { tag: "BESTBUY", store: "Best Buy", hashtag: "#BestBuy" };
  if (s.includes("target.com")) return { tag: "TARGET", store: "Target", hashtag: "#Target" };
  if (s.includes("homedepot.com")) return { tag: "HOMEDEPOT", store: "Home Depot", hashtag: "#HomeDepot" };
  if (s.includes("slickdeals.net")) return { tag: "SLICKDEALS", store: "Slickdeals", hashtag: "#Slickdeals" };
  return { tag: "US", store: "US Deals", hashtag: "#USDeals" };
}

function pickDealsWithFairness(deals, storeOrder) {
  const sorted = [...deals].sort((a, b) => scoreDeal(b) - scoreDeal(a));
  const perStoreCount = new Map();
  const out = [];

  // Pass 1: at least 1 per store (if available)
  for (const tag of storeOrder) {
    const first = sorted.find((d) => (d.storeTag || "") === tag);
    if (!first) continue;
    if (out.length >= MAX_TOTAL) break;
    out.push(first);
    perStoreCount.set(tag, 1);
  }

  // Pass 2: fill by score with per-store cap
  for (const d of sorted) {
    if (out.length >= MAX_TOTAL) break;
    if (out.some((x) => x.id === d.id)) continue;

    const k = d.storeTag || "UNKNOWN";
    const c = perStoreCount.get(k) || 0;
    if (c >= MAX_PER_STORE) continue;
    perStoreCount.set(k, c + 1);
    out.push(d);
  }

  return out;
}

// ---------------- main ----------------

const state = loadState(POSTED_PATH);
pruneOld(state, DAYS_TTL);

const storeFetchers = [
  { tag: "AMAZONUS", name: "Amazon US", hashtag: "#Amazon", fn: fetchAmazon },
  { tag: "WALMART", name: "Walmart", hashtag: "#Walmart", fn: fetchWalmart },
  { tag: "BESTBUY", name: "Best Buy", hashtag: "#BestBuy", fn: fetchBestBuy },
  { tag: "TARGET", name: "Target", hashtag: "#Target", fn: fetchTarget },
  { tag: "HOMEDEPOT", name: "Home Depot", hashtag: "#HomeDepot", fn: fetchHomeDepot }
];

// Fetch in sequence (stable on GitHub Actions)
const all = [];
for (const s of storeFetchers) {
  try {
    const deals = await s.fn({ limit: Math.max(12, MAX_PER_STORE * 5) });
    for (const d of deals) {
      const cleaned = sanitizePrices({ now: d.now, was: d.was });
      const pct = calcDiscountPct(cleaned.now, cleaned.was);
      all.push({
        ...d,
        storeTag: s.tag,
        store: d.store || s.name,
        _hashtag: s.hashtag,
        url: stripQuery(d.url || ""),
        now: cleaned.now,
        was: cleaned.was,
        discountPct: pct ?? d.discountPct
      });
    }
    console.log(`Fetched ${s.tag}: ${deals.length}`);
  } catch (e) {
    console.log(`⚠️ Fetch failed ${s.tag}: ${String(e)}`);
  }
}

let base = all.filter((d) => d.title && d.url && !hasPosted(state, d));

// If stores are dry, inject Slickdeals RSS (always-on fallback)
if (FALLBACK_MODE && base.length < MIN_DAILY) {
  try {
    const rssDeals = await fetchSlickdeals({ limit: 120 });
    for (const d of rssDeals) {
      const cls = classifyByUrl(d.url);
      if (!hasPosted(state, d)) {
        base.push({
          ...d,
          store: d.store || cls.store,
          storeTag: d.storeTag || cls.tag,
          _hashtag: cls.hashtag,
          id: stripQuery(d.url)
        });
      }
    }
    console.log(`Fallback injected (Slickdeals). total now: ${base.length}`);
  } catch (e) {
    console.log(`⚠️ Slickdeals fallback failed: ${String(e)}`);
  }
}

// Hard fallback list (never fail)
if (FALLBACK_MODE && base.length < MIN_DAILY) {
  const local = await fetchLocalFallback();
  for (const d of local) {
    const cls = classifyByUrl(d.url);
    base.push({
      ...d,
      store: d.store || cls.store,
      storeTag: cls.tag,
      _hashtag: cls.hashtag,
      id: stripQuery(d.url)
    });
  }
  console.log(`Fallback injected (static). total now: ${base.length}`);
}

const storeOrder = storeFetchers.map((s) => s.tag).concat(["SLICKDEALS"]);

let selected = pickDealsWithFairness(base.filter(strictOk), storeOrder);
if (FALLBACK_MODE && selected.length < MIN_DAILY) {
  selected = pickDealsWithFairness(base, storeOrder);
}

selected = selected.slice(0, MAX_TOTAL);
console.log(`Selected to post: ${selected.length}`);

let posted = 0;
for (const d of selected) {
  const rankTag = posted < Math.min(4, MAX_TOTAL) ? "#TopDeals" : "#GoodDeal";
  const dealUrl = affiliateUrl(d.storeTag || "", d.url || "");

  const caption = formatDealCard({
    title: d.title,
    store: d.store,
    now: d.now || "",
    was: d.was || "",
    discountPct: d.discountPct,
    extraLine: d.extraLine || "",
    endsText: "Limited time (check deal page)",
    hashtags: [rankTag, d._hashtag || "", "#Today", "#USDeals"].filter(Boolean)
  });

  try {
    if (d.imageUrl) {
      await sendPhotoPost({
        imageUrl: d.imageUrl,
        caption,
        buttons: [
          [{ text: "👉 Get Deal", url: dealUrl }],
          [{ text: "📌 Browse More", url: browseMoreUrl(d.storeTag || "") }]
        ]
      });
    } else {
      throw new Error("No imageUrl");
    }
  } catch (e) {
    console.log(`⚠️ Photo skipped/fail -> text fallback. reason=${String(e)}`);
    await sendTextPost({
      text: `${caption}\n\n👉 Get Deal: ${dealUrl}\n📌 Browse More: ${browseMoreUrl(d.storeTag || "")}`,
      disablePreview: false
    });
  }

  rememberPosted(state, d);
  posted++;
  await sleep(RATE_LIMIT_MS);
}

saveState(POSTED_PATH, state);
console.log(`✅ Done. Posted ${posted}/${MAX_TOTAL} deals.`);
