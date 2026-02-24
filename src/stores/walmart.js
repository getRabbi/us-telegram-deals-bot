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

export async function fetchWalmart({ limit = 8 } = {}) {
  const hub = "https://www.walmart.com/cp/deals/5438";

  return withBrowser(async (page) => {
    await page.goto(hub, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6500);

    // Scroll to load more tiles
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1700);
      await page.waitForTimeout(1200);
    }

    const hrefs = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll('a[href^="/"]'));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        // Walmart product pages often contain /ip/
        if (href.includes("/ip/")) out.push(href);
        if (out.length >= 220) break;
      }
      return out;
    });

    const urls = [];
    const seen = new Set();
    for (const h of hrefs) {
      const abs = `https://www.walmart.com${h}`;
      const clean = stripQuery(abs);
      if (seen.has(clean)) continue;
      seen.add(clean);
      urls.push(clean);
      if (urls.length >= 50) break;
    }

    const deals = [];
    for (const url of urls) {
      if (deals.length >= limit * 5) break;
      const d = await enrichWalmart(page, url);
      if (!d.title || !d.now) continue;
      deals.push({
        store: "Walmart",
        storeTag: "WALMART",
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

async function enrichWalmart(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";

      const title =
        t('h1[data-automation-id="product-title"]') ||
        t("h1") ||
        a('meta[property="og:title"]', "content") ||
        document.title ||
        "";

      const img =
        a('meta[property="og:image"]', "content") ||
        a("img", "src") ||
        "";

      // Pull a slice of visible text for price parsing
      const text = (document.body?.innerText || "").slice(0, 12000);

      // product id (best effort)
      const m = location.pathname.match(/\/ip\/(?:.*\/)?(\d+)/);
      const id = m ? m[1] : "";

      return { title, img, text, id };
    });

    const title = normalizeSpace(data.title).replace(/\s*\|\s*Walmart.*$/i, "").slice(0, 140);

    // Price parsing: first 2 $-prices found in body text
    const prices = extractPricesFromText(data.text);
    const cleaned = sanitizePrices(prices);
    const now = normalizePriceText(cleaned.now);
    const was = normalizePriceText(cleaned.was);
    const discountPct = calcDiscountPct(now, was);

    const imageUrl = ensureHighResImageUrl(data.img);

    return {
      id: data.id,
      title,
      now,
      was,
      discountPct,
      imageUrl
    };
  } catch {
    return { id: "", title: "", now: "", was: "", discountPct: undefined, imageUrl: "" };
  }
}
