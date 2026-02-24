import { sendMessage, pinMessage } from "./telegram.js";

function channelUsername() {
  // If TELEGRAM_CHAT_ID is @YourChannel, we can build Telegram "?q=#hashtag" links.
  const chat = process.env.TELEGRAM_CHAT_ID || "";
  if (chat.startsWith("@")) return chat.slice(1);
  // If it's a numeric chat id, we can't build "?q=..." links.
  return "";
}

function qLink(username, hashtag) {
  const tag = encodeURIComponent(`#${hashtag}`);
  return `https://t.me/${username}?q=${tag}`;
}

const username = channelUsername();
if (!username) {
  throw new Error("TELEGRAM_CHAT_ID must be in @YourChannel format to enable MENU hashtag search links.");
}

const menuText =
  `📌 <b>DEALS MENU</b>\n` +
  `Browse Top Deals and store-wise deals 👇\n\n` +
  `🔥 <b>Top Deals Only</b>: best offers (#TopDeals)\n` +
  `🛒 <b>All Posts</b>: full channel feed\n\n` +
  `Tip: Use store buttons to jump to posts tagged for that store.`;

const buttons = [
  [{ text: "🔥 Top Deals Only", url: qLink(username, "TopDeals") }],
  [{ text: "🛒 All Deals", url: `https://t.me/${username}` }],

  [{ text: "🛒 Amazon", url: qLink(username, "Amazon") },
   { text: "🏪 Walmart", url: qLink(username, "Walmart") }],

  [{ text: "💻 Best Buy", url: qLink(username, "BestBuy") },
   { text: "🎯 Target", url: qLink(username, "Target") }],

  [{ text: "🏠 Home Depot", url: qLink(username, "HomeDepot") },
   { text: "📰 Slickdeals", url: qLink(username, "Slickdeals") }],

  // External quick links (official deal pages)
  [{ text: "Amazon Deals Page", url: "https://www.amazon.com/gp/goldbox" }],
  [{ text: "Walmart Deals", url: "https://www.walmart.com/cp/deals/5438" }],
  [{ text: "Best Buy Deals", url: "https://www.bestbuy.com/site/electronics/deals/abcat0500000.c?id=abcat0500000" }],
  [{ text: "Target Deals", url: "https://www.target.com/c/deals/-/N-4xw74" }],
  [{ text: "Home Depot Special Buy", url: "https://www.homedepot.com/SpecialBuy/SpecialBuyOfTheDay" }],
];

const msg = await sendMessage({ text: menuText, buttons });
await pinMessage({ messageId: msg.message_id });

console.log("✅ MENU posted & pinned.");
