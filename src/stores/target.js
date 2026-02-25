// src/stores/target.js
import { withBrowser } from "../browser.js";
import {
  normalizeSpace,
  normalizePriceText,
  sanitizePrices,
  calcDiscountPct,
  stripQuery,
  extractPricesFromText,
  ensureHighResImageUrl,
  priceToNumber
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

/**
 * Target often puts multiple $ amounts in text (unit price, savings, etc.)
 * Also sometimes we accidentally treat cents (1500) as dollars ($1500).
 * This function:
 *  - extracts price block text from DOM + JSON-LD first
 *  - uses extractPricesFromText only as fallback
 *  - applies a "cents -> dollars" guard for suspiciously huge extracted values
 */
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

      const ogImg = a('meta[property="og:image"]', "content") || "";

      // --------------- Price extraction (DOM first) ---------------
      const selList = [
        '[data-test="product-price"]',
        '[data-test="product-price"] *',
        '[data-test="current-price"]',
        '[data-test="current-price"] *',
        '[data-test="price"]',
        '[data-test="price"] *',
        '[data-test="shippingAndReturns"]', // sometimes contains price context
        'div[data-test="product-price"]',
        'div[data-test="product-price"] *'
      ];

      let priceText = "";
      for (const sel of selList) {
        const el = document.querySelector(sel);
        const txt = el?.textContent?.trim() || "";
        if (txt && txt.includes("$")) {
          // keep only a small slice to avoid noise
          priceText = txt.slice(0, 400);
          break;
        }
      }

      // --------------- JSON-LD (often has exact price) ---------------
      let ldPrice = "";
      let ldCurrency = "";
      let ldImg = "";

      const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of ldScripts) {
        const raw = s.textContent || "";
        if (!raw || raw.length < 10) continue;
        try {
          const json = JSON.parse(raw);

          const nodes = Array.isArray(json) ? json : [json];
          for (const node of nodes) {
            // image can be string or array
            if (!ldImg) {
              const img = node?.image;
              if (typeof img === "string") ldImg = img;
              else if (Array.isArray(img) && typeof img[0] === "string") ldImg = img[0];
            }

            const offers = node?.offers;
            const offerArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
            for (const off of offerArr) {
              const price = off?.price ?? off?.lowPrice ?? "";
              const currency = off?.priceCurrency ?? "";
              if (price && String(price).length) {
                ldPrice = String(price);
                ldCurrency = String(currency || "");
                break;
              }
            }
            if (ldPrice) break;
          }
        } catch {
          // ignore bad JSON
        }
        if (ldPrice) break;
      }

      // build a compact text blob: JSON-LD price + DOM price + small body slice
      const bodyText = (document.body?.innerText || "").slice(0, 6000);
      const combined =
        (ldPrice ? `LD_PRICE: ${ldCurrency ? ldCurrency + " " : ""}$${ldPrice}\n` : "") +
        (priceText ? `PRICE_BLOCK: ${priceText}\n` : "") +
        bodyText;

      const m = location.pathname.match(/A-(\d+)/);
      const id = m ? m[1] : "";

      return { title, ogImg, ldImg, combined, id };
    });

    const title = normalizeSpace(data.title)
      .replace(/\s*\|\s*Target.*$/i, "")
      .slice(0, 140);

    // Extract prices from our combined blob (LD + price block + small body)
    const prices = extractPricesFromText(data.combined);
    const cleaned = sanitizePrices(prices);

    // ---- cents guard (TARGET-specific) ----
    const fixCents = (p) => {
      const raw = String(p || "").trim();
      if (!raw) return "";

      const n = priceToNumber(raw);
      if (!n) return raw;

      // If extracted price is huge, assume it was cents (1500 => 15.00)
      // Keep it conservative to avoid breaking real big-ticket items.
      // Grocery/drinks etc. won't be $500+ normally.
      if (n >= 500 && n <= 200000) {
        // Only apply if string didn't clearly show decimals like $1500.00
        // (Still safe, but keeps guard conservative)
        const hasDecimal = /\.\d{2}\b/.test(raw);
        const dollars = n / 100;
        if (!hasDecimal && dollars >= 0.5 && dollars <= 2000) {
          return `$${dollars.toFixed(2)}`;
        }
      }
      return raw;
    };

    cleaned.now = fixCents(cleaned.now);
    cleaned.was = fixCents(cleaned.was);

    const now = normalizePriceText(cleaned.now);
    const was = normalizePriceText(cleaned.was);
    const discountPct = calcDiscountPct(now, was);

    // image: prefer JSON-LD image if present, else og:image
    const imgRaw = data.ldImg || data.ogImg || "";
    const imageUrl = ensureHighResImageUrl(imgRaw);

    return { id: data.id, title, now, was, discountPct, imageUrl };
  } catch {
    return { id: "", title: "", now: "", was: "", discountPct: undefined, imageUrl: "" };
  }
}