import { withBrowser } from "../browser.js";
import {
  normalizeSpace,
  normalizePriceText,
  sanitizePrices,
  calcDiscountPct,
  stripQuery,
  extractPricesFromText,
  ensureHighResImageUrl
} from "../utils.js";

export async function fetchTarget({ limit = 6 } = {}) {
  const hub = "https://www.target.com/c/deals/-/N-4xw74";

  return withBrowser(async (page) => {
    await page.goto(hub, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(7000);

    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1700);
      await page.waitForTimeout(1400);
    }

    const hrefs = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        // product pages are /p/.../A-########
        if (href.startsWith("/p/") && href.includes("A-")) out.push(href);
        if (out.length >= 200) break;
      }
      return out;
    });

    const urls = [];
    const seen = new Set();
    for (const h of hrefs) {
      const abs = `https://www.target.com${h}`;
      const clean = stripQuery(abs);
      if (seen.has(clean)) continue;
      seen.add(clean);
      urls.push(clean);
      if (urls.length >= 35) break;
    }

    const deals = [];
    for (const url of urls) {
      if (deals.length >= limit * 5) break;
      const d = await enrichTarget(page, url);
      if (!d.title || !d.now) continue;
      deals.push({
        store: "Target",
        storeTag: "TARGET",
        id: d.id || url,
        title: d.title,
        now: d.now,
        was: d.was,
        discountPct: d.discountPct,
        imageUrl: d.imageUrl,
        url
      });
      await page.waitForTimeout(700);
    }

    return deals.slice(0, limit);
  });
}

async function enrichTarget(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3200);

    const data = await page.evaluate(() => {
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";
      const t = (sel) => document.querySelector(sel)?.textContent?.trim() || "";

      const title =
        t("h1") ||
        a('meta[property="og:title"]', "content") ||
        document.title ||
        "";

      const img = a('meta[property="og:image"]', "content") || "";
      const text = (document.body?.innerText || "").slice(0, 12000);

      const m = location.pathname.match(/A-(\d+)/);
      const id = m ? m[1] : "";
      return { title, img, text, id };
    });

    const title = normalizeSpace(data.title)
      .replace(/\s*\|\s*Target.*$/i, "")
      .slice(0, 140);

    const prices = extractPricesFromText(data.text);
    const cleaned = sanitizePrices(prices);
    const now = normalizePriceText(cleaned.now);
    const was = normalizePriceText(cleaned.was);
    const discountPct = calcDiscountPct(now, was);
    const imageUrl = ensureHighResImageUrl(data.img);

    return { id: data.id, title, now, was, discountPct, imageUrl };
  } catch {
    return { id: "", title: "", now: "", was: "", discountPct: undefined, imageUrl: "" };
  }
}
