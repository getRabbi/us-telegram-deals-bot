import { withBrowser } from "../browser.js";
import {
  normalizeSpace,
  normalizePriceText,
  calcDiscountPct,
  stripQuery,
  priceToNumber,
  extractPricesFromText,
  sanitizePrices
} from "../utils.js";

/**
 * Amazon US: discover from Goldbox then enrich each product page.
 * Designed to be permissive (so it still returns deals daily).
 * High-ticket/high-discount preference is applied later in run_all.js.
 */
export async function fetchAmazon({ limit = 6 } = {}) {
  const dealsHub = "https://www.amazon.com/gp/goldbox";

  return withBrowser(async (page) => {
    await page.goto(dealsHub, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6500);

    // Scroll a bit to load more tiles
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(1100);
    }

    const hrefs = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (href.includes("/dp/") || href.includes("/gp/goldbox/deal/")) out.push(href);
        if (out.length >= 300) break;
      }
      return out;
    });

    const seen = new Set();
    const urls = [];
    for (const h of hrefs) {
      const abs = toAbs(h);
      if (!abs) continue;
      const dp = normalizeDp(abs);
      const clean = stripQuery(dp);
      if (seen.has(clean)) continue;
      seen.add(clean);
      urls.push(clean);
      if (urls.length >= 90) break;
    }

    const deals = [];
    for (const url of urls) {
      if (deals.length >= limit * 5) break; // buffer

      const info = await enrichAmazon(page, url);
      if (!info.title || !info.imageUrl || !info.now) continue;

      const item = {
        store: "Amazon US",
        storeTag: "AMAZONUS",
        id: info.asin || url,
        asin: info.asin,
        title: info.title,
        now: info.now,
        was: info.was,
        discountPct: info.discountPct,
        imageUrl: info.imageUrl,
        url
      };

      deals.push(item);
      await page.waitForTimeout(650);
    }

    return deals.filter(isReasonableAmazonDeal).slice(0, limit);
  });
}

async function enrichAmazon(page, productUrl) {
  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2400);

    const data = await page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";

      const title =
        t("#productTitle") ||
        t("h1#title span") ||
        document.title?.replace(/\s*-\s*Amazon.*$/i, "").trim() ||
        "";

      const now =
        t("#corePriceDisplay_desktop_feature_div span.a-price span.a-offscreen") ||
        t("#corePriceDisplay_mobile_feature_div span.a-price span.a-offscreen") ||
        t("span.a-price span.a-offscreen") ||
        "";

      const was =
        t("#corePriceDisplay_desktop_feature_div span.a-price.a-text-price span.a-offscreen") ||
        t("#corePriceDisplay_mobile_feature_div span.a-price.a-text-price span.a-offscreen") ||
        t("span.a-price.a-text-price span.a-offscreen") ||
        "";

      // Grab a wider price block text to avoid picking per-unit prices (e.g., $0.05/oz, $18.00/count)
      const priceText =
        t("#corePriceDisplay_desktop_feature_div") ||
        t("#corePriceDisplay_mobile_feature_div") ||
        "";

      const img =
        a("#imgTagWrapperId img", "data-old-hires") ||
        a("#landingImage", "data-old-hires") ||
        a("#landingImage", "src") ||
        a("#imgTagWrapperId img", "src") ||
        a('meta[property="og:image"]', "content") ||
        "";

      const m = location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
      const asin = m ? m[1] : "";

      return { title, now, was, img, asin, priceText };
    });

    const title = normalizeSpace(data.title).slice(0, 140);
    const prices = extractPricesFromText(data.priceText || "");
    const cleaned = sanitizePrices({ now: prices.now || data.now, was: prices.was || data.was });
    const now = normalizePriceText(cleaned.now);
    const was = normalizePriceText(cleaned.was);
    const discountPct = calcDiscountPct(now, was);

    const img =
      (data.img || "").includes(".svg") || (data.img || "").startsWith("data:")
        ? ""
        : data.img;

    return {
      asin: data.asin || "",
      title,
      now,
      was,
      discountPct,
      imageUrl: img || ""
    };
  } catch {
    return { asin: "", title: "", now: "", was: "", discountPct: undefined, imageUrl: "" };
  }
}

function isReasonableAmazonDeal(item) {
  const title = (item.title || "").toLowerCase();
  const blockWords = [
    "case",
    "cover",
    "screen protector",
    "protector",
    "cable",
    "charger",
    "adapter",
    "hdmi",
    "usb",
    "replacement",
    "refill",
    "sticker",
    "kindle edition",
    "tempered glass",
    "ear tips"
  ];
  if (blockWords.some((w) => title.includes(w))) return false;

  const nowN = priceToNumber(item.now);
  if (!nowN || nowN < 35) return false;
  return true;
}

function toAbs(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://www.amazon.com${href}`;
  return "";
}

function normalizeDp(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    if (m) return `https://www.amazon.com/dp/${m[1]}`;
    return u;
  } catch {
    return u;
  }
}
