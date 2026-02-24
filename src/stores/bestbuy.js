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

export async function fetchBestBuy({ limit = 8 } = {}) {
  const hub = "https://www.bestbuy.com/site/electronics/deals/abcat0500000.c?id=abcat0500000";

  return withBrowser(async (page) => {
    await page.goto(hub, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6000);

    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(1200);
    }

    const hrefs = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        // BestBuy product pages typically contain /site/
        if (href.startsWith("/site/") && href.includes(".p?")) out.push(href);
        if (out.length >= 200) break;
      }
      return out;
    });

    const urls = [];
    const seen = new Set();
    for (const h of hrefs) {
      const abs = `https://www.bestbuy.com${h}`;
      const clean = stripQuery(abs);
      if (seen.has(clean)) continue;
      seen.add(clean);
      urls.push(clean);
      if (urls.length >= 45) break;
    }

    const deals = [];
    for (const url of urls) {
      if (deals.length >= limit * 5) break;
      const d = await enrichBestBuy(page, url);
      if (!d.title || !d.now) continue;
      deals.push({
        store: "Best Buy",
        storeTag: "BESTBUY",
        id: d.id || url,
        title: d.title,
        now: d.now,
        was: d.was,
        discountPct: d.discountPct,
        imageUrl: d.imageUrl,
        url
      });
      await page.waitForTimeout(650);
    }

    return deals.slice(0, limit);
  });
}

async function enrichBestBuy(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2600);

    const data = await page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";

      const title =
        t("h1") ||
        a('meta[property="og:title"]', "content") ||
        document.title ||
        "";

      const img =
        a('meta[property="og:image"]', "content") ||
        a('img[src*=".jpg"], img[src*=".png"], img[src*=".webp"]', "src") ||
        "";

      const priceNow =
        t("[data-testid='customer-price']") ||
        t(".priceView-customer-price") ||
        a("meta[itemprop='price']", "content") ||
        "";

      const priceWas =
        t(".pricing-price__regular-price") ||
        t(".priceView-hero-price span[aria-hidden='true']") ||
        "";

      const text = (document.body?.innerText || "").slice(0, 12000);

      // sku in URL like .../p?skuId=123
      const u = new URL(location.href);
      const sku = u.searchParams.get("skuId") || "";

      return { title, img, priceNow, priceWas, text, sku };
    });

    const title = normalizeSpace(data.title).replace(/\s*\|\s*Best Buy.*$/i, "").slice(0, 140);

    // Price: prefer explicit, else fallback to first 2 prices in text
    let now = normalizePriceText(`$${data.priceNow}`);
    let was = normalizePriceText(data.priceWas);
    if (!now) {
      const prices = extractPricesFromText(data.text);
      const cleaned = sanitizePrices(prices);
      now = normalizePriceText(cleaned.now);
      was = normalizePriceText(cleaned.was);
    }

    const cleaned2 = sanitizePrices({ now, was });
    now = normalizePriceText(cleaned2.now);
    was = normalizePriceText(cleaned2.was);
    const discountPct = calcDiscountPct(now, was);
    const imageUrl = ensureHighResImageUrl(data.img);

    return { id: data.sku, title, now, was, discountPct, imageUrl };
  } catch {
    return { id: "", title: "", now: "", was: "", discountPct: undefined, imageUrl: "" };
  }
}
