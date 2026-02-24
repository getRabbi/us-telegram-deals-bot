import { chromium } from "playwright";

export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }
    });
    return await fn(page);
  } finally {
    await browser.close();
  }
}
