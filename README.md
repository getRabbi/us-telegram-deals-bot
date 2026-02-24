# US Telegram Deals Bot (PRO)

Headless **Playwright + Node 20** bot that fetches deals from multiple **US stores** and auto-posts them to a **Telegram channel**.

## Stores

Primary (scraped with Playwright):
- Amazon US (Gold Box)
- Walmart
- Best Buy
- Target
- Home Depot

Fallback (RSS):
- Slickdeals (keeps daily posts flowing even if retailers block/slow)

## How it works

1) Fetch deals from each store
2) Normalize prices, compute discount %, score deals
3) De-duplicate using `data/posted.json` (TTL-based)
4) Fairness: cap posts per store
5) Post to Telegram (photo if available, otherwise text fallback)
6) Commit updated `posted.json` back to the repo (GitHub Actions)

## Required GitHub Secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:
- `AMAZON_TAG` (Amazon Associates tag, e.g. `xxxx-20`)
- `DEEPLINK_BASE_WALMART`, `DEEPLINK_BASE_BESTBUY`, `DEEPLINK_BASE_TARGET`, `DEEPLINK_BASE_HOMEDEPOT`
  - Format: a prefix where we append `encodeURIComponent(targetUrl)`.
  - Example: `https://network.example/deeplink?url=`

## Local run

```bash
npm install
npx playwright install --with-deps chromium

export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...

npm run run:all
```

## Tuning (env)

- `MAX_POSTS_TOTAL` (default: 15)
- `MAX_POSTS_PER_STORE` (default: 4)
- `MIN_POSTS_DAILY` (default: 10)
- `DAYS_TTL` (default: 7)
- `RATE_LIMIT_MS` (default: 4500)

Strict preference (does not block posting):
- `STRICT_MIN_DISCOUNT` (default: 20)
- `STRICT_MIN_PRICE` (default: 120)

Fallback:
- `FALLBACK_MODE` (default: 1)
