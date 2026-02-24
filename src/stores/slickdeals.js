import {
  normalizeSpace,
  sanitizePrices,
  calcDiscountPct,
  stripQuery,
  extractPricesFromText
} from "../utils.js";

/**
 * Slickdeals RSS fallback (US): stable + no API keys.
 * We post as text (images in RSS are inconsistent).
 */
export async function fetchSlickdeals({ limit = 40 } = {}) {
  const rss = "https://slickdeals.net/newsearch.php?searcharea=deals&searchin=first&rss=1";
  const text = await fetch(rss).then((r) => r.text());

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(text))) {
    const block = m[1];
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || [])[1] ||
      (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ||
      "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const desc =
      (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] ||
      (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] ||
      "";

    if (!title || !link) continue;

    const cleanTitle = normalizeSpace(title)
      .replace(/&amp;/g, "&")
      .replace(/\s+\|\s*Slickdeals.*$/i, "")
      .slice(0, 140);

    const cleanLink = stripQuery(link);
    const prices = extractPricesFromText(`${cleanTitle} ${desc}`);
    const cleaned = sanitizePrices(prices);
    const pct = calcDiscountPct(cleaned.now, cleaned.was);

    // Extract % from title like "50% off"
    const pctMatch =
      cleanTitle.match(/\b(\d{1,2})%\s*off\b/i) ||
      cleanTitle.match(/\bsave\s*(\d{1,2})%\b/i);
    const pctFromTitle = pctMatch ? Number(pctMatch[1]) : undefined;

    items.push({
      store: "Slickdeals",
      storeTag: "SLICKDEALS",
      id: cleanLink,
      title: cleanTitle,
      now: cleaned.now,
      was: cleaned.was,
      discountPct: pct ?? pctFromTitle,
      imageUrl: "",
      url: cleanLink,
      extraLine: "(Fallback source) Please check the deal page for coupons/conditions."
    });

    if (items.length >= limit) break;
  }

  return items;
}
