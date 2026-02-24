import { stripQuery, safeUrl } from "./utils.js";

/**
 * Affiliate handling:
 * - Amazon uses AMAZON_TAG
 * - Other stores use optional "DEEPLINK_BASE_*" environment variables.
 *   The deeplink base should be a prefix where we append encodeURIComponent(targetUrl).
 *   Example: https://network.com/deeplink?mid=123&url=
 */
export function affiliateUrl(storeTag, targetUrl) {
  const clean = stripQuery(targetUrl);
  if (!clean) return targetUrl;

  const tag = storeTag.toUpperCase();

  if (tag === "AMAZONUS") {
    return addAmazonTag(clean, process.env.AMAZON_TAG || "");
  }

  const envKey = `DEEPLINK_BASE_${tag}`;
  const base = process.env[envKey];
  if (!base) return clean;

  // base could already contain url=, so we just append encoded target
  return safeUrl(base + encodeURIComponent(clean)) || clean;
}

function addAmazonTag(u, tag) {
  if (!tag) return u;
  try {
    const url = new URL(u);
    url.searchParams.set("tag", tag);
    return url.toString();
  } catch {
    return u;
  }
}
