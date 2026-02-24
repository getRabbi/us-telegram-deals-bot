function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function apiUrl(method) {
  const token = mustEnv("TELEGRAM_BOT_TOKEN");
  return `https://api.telegram.org/bot${token}/${method}`;
}

function safeString(v) {
  return String(v ?? "");
}

import { ensureHighResImageUrl, isLowResImageUrl } from "./utils.js";

async function fetchImageBytes(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Image fetch failed status=${res.status} url=${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "image/jpeg";
  return { buf, contentType: ct };
}

async function postJson(method, payload) {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed (non-JSON). status=${res.status} body=${text}`);
  }

  if (!json?.ok) {
    throw new Error(`Telegram ${method} failed. status=${res.status} response=${safeString(JSON.stringify(json))}`);
  }
  return json.result;
}

async function postMultipart(method, formData) {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    body: formData,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed (non-JSON). status=${res.status} body=${text}`);
  }

  if (!json?.ok) {
    throw new Error(`Telegram ${method} failed. status=${res.status} response=${safeString(JSON.stringify(json))}`);
  }
  return json.result;
}

/**
 * Send photo post
 * - try upgraded URL (strip query)
 * - download bytes and upload via multipart (reduces Telegram "failed to get HTTP URL content")
 * - if image too small -> throw to let caller fallback to text (avoids blur)
 */
export async function sendPhotoPost({
  imageUrl,
  caption,
  buttons,
  disablePreview = true,
  messageThreadId,
}) {
  const chatId = mustEnv("TELEGRAM_CHAT_ID");

  // Upgrade thumbnails (e.g., Shopify 32x32) to a large size to avoid blur.
  const upgraded = ensureHighResImageUrl(safeString(imageUrl), 1200);
  const { buf } = await fetchImageBytes(upgraded);

  // If URL looks low-res OR file is tiny, it's usually a thumbnail => blur.
  // Let caller fallback to text.
  if (isLowResImageUrl(upgraded) || !buf || buf.length < 35 * 1024) {
    throw new Error(`Low-res image (too small). size=${buf?.length || 0} url=${upgraded}`);
  }

  const fd = new FormData();
  fd.append("chat_id", safeString(chatId));
  fd.append("caption", safeString(caption));
  fd.append("parse_mode", "HTML");
  fd.append("disable_web_page_preview", String(Boolean(disablePreview)));

  if (messageThreadId) fd.append("message_thread_id", safeString(messageThreadId));

  // buttons
  const replyMarkup = { inline_keyboard: buttons || [] };
  fd.append("reply_markup", JSON.stringify(replyMarkup));

  // attach file
  const file = new Blob([buf], { type: "image/jpeg" });
  fd.append("photo", file, "deal.jpg");

  return postMultipart("sendPhoto", fd);
}

export async function sendMessage({
  text,
  buttons,
  disablePreview = true,
  messageThreadId,
}) {
  const chatId = mustEnv("TELEGRAM_CHAT_ID");

  const payload = {
    chat_id: chatId,
    text: safeString(text),
    parse_mode: "HTML",
    disable_web_page_preview: Boolean(disablePreview),
    reply_markup: { inline_keyboard: buttons || [] },
  };

  if (messageThreadId) payload.message_thread_id = messageThreadId;

  return postJson("sendMessage", payload);
}

export async function sendTextPost({ text, disablePreview = false }) {
  return sendMessage({ text, disablePreview });
}

export async function pinMessage({ messageId, disableNotification = true }) {
  const chatId = mustEnv("TELEGRAM_CHAT_ID");

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: Boolean(disableNotification),
  };

  await postJson("pinChatMessage", payload);
  return true;
}
