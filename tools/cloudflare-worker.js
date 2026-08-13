/**
 * VelvetNight — Cloudflare Worker (dán vào Dashboard → fancy-sun-962d)
 * WORKER_VERSION: 1.0.11
 *
 * Routes:
 *   POST /api/video-token
 *   GET|HEAD /api/video
 *   POST /api/top-up-signature
 *   GET  /api/top-up-status?order_id=...
 *   POST /api/top-up-sdk-report
 *   POST|GET /webhook/tevi
 *
 * Bindings:
 *   VIDEOS         → R2 bucket (video reward)
 *   TOPUP_ORDERS   → KV namespace (lưu order pending/paid)
 *
 * Variables:
 *   ALLOWED_ORIGIN=https://tienunity187.github.io
 *   APP_ID=SRB06792
 *   TEVI_API_BASE=https://developer-api.sbx.tevi.dev
 *   TEVI_VERIFY_URL=https://developer-api.sbx.tevi.dev/api/v1/auth/user
 *   TOKEN_TTL_SECONDS=600
 *
 * Secrets:
 *   VIDEO_SIGNING_SECRET
 *   TEVI_WEBHOOK_SECRET   ← Webhook secret từ Tevi Developer Dashboard
 */

const WORKER_VERSION = "1.0.12";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REWARD_FILE_RE = /^vn_reward_lv(0[5-9]|[1-4][0-9]|50)\.mp4$/;
const ORDER_TTL_SECONDS = 86400;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/webhook/tevi") {
        return handleTeviWebhook(request, env);
      }
      if (request.method === "OPTIONS") {
        return handleOptions(request, env);
      }
      if (url.pathname === "/api/video-token" && request.method === "POST") {
        return createVideoToken(request, env, url.origin);
      }
      if (url.pathname === "/api/video" && (request.method === "GET" || request.method === "HEAD")) {
        return serveVideo(request, env);
      }
      if (url.pathname === "/api/top-up-signature" && request.method === "POST") {
        return createTopUpSignature(request, env);
      }
      if (url.pathname === "/api/top-up-status" && request.method === "GET") {
        return getTopUpStatus(request, env);
      }
      if (url.pathname === "/api/top-up-sdk-report" && request.method === "POST") {
        return reportTopUpSdkCallback(request, env);
      }
      return json({ success: false, message: "Not found", worker_version: WORKER_VERSION }, 404, request, env);
    } catch (err) {
      console.error("[Worker]", err);
      return json({ success: false, message: err?.message || "Internal error", worker_version: WORKER_VERSION }, 500, request, env);
    }
  },
};

/* ===================== CORS ===================== */

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function pickAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return null;
  return getAllowedOrigins(env).includes(origin) ? origin : null;
}

function corsHeaders(request, env) {
  const origin = pickAllowedOrigin(request, env);
  const headers = {
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "Access-Control-Max-Age": "86400",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function validateOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return null;
  if (pickAllowedOrigin(request, env)) return null;
  return json({ success: false, message: `Origin not allowed: ${origin}` }, 403, request, env);
}

function handleOptions(request, env) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) },
  });
}

/* ===================== Helpers ===================== */

function getBearer(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return authorization.trim();
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(decoder.decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Docs: JSON.stringify(payload, separators=(",", ":")) */
function stableJsonStringify(obj) {
  return JSON.stringify(obj);
}

async function verifyTeviWebhookSignature(payload, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const expected = await hmacSha256Hex(secret, stableJsonStringify(payload));
  return timingSafeEqual(expected.toLowerCase(), String(signatureHeader).trim().toLowerCase());
}

async function verifyTeviUser(request, env) {
  const userAppToken = getBearer(request);
  if (!userAppToken) return null;
  const verifyUrl = env.TEVI_VERIFY_URL || "https://developer-api.sbx.tevi.dev/api/v1/auth/user";
  const response = await fetch(verifyUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${userAppToken}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return { ok: true };
  }
}

function orderKey(orderId) {
  return `order:${orderId}`;
}

function exchangeKey(exchangeId) {
  return `exchange:${exchangeId}`;
}

async function saveOrder(env, record) {
  if (!env.TOPUP_ORDERS) {
    console.warn("[Worker] TOPUP_ORDERS KV not bound — order not persisted");
    return;
  }
  const text = JSON.stringify(record);
  await env.TOPUP_ORDERS.put(orderKey(record.order_id), text, { expirationTtl: ORDER_TTL_SECONDS });
  if (record.exchange_id) {
    await env.TOPUP_ORDERS.put(exchangeKey(record.exchange_id), record.order_id, { expirationTtl: ORDER_TTL_SECONDS });
  }
}

async function loadOrder(env, orderId) {
  if (!env.TOPUP_ORDERS) return null;
  const raw = await env.TOPUP_ORDERS.get(orderKey(orderId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function orderAgeSeconds(record) {
  if (!record?.created_at) return 0;
  const t = Date.parse(record.created_at);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function buildPendingHint(record, env) {
  const age = orderAgeSeconds(record);
  const parts = [`Đã chờ webhook user_topup ${age}s.`];

  const sdk = record.sdk_callback;
  if (sdk) {
    parts.push(
      `SDK call=${sdk.call ?? "?"} error_code=${sdk.error_code ?? "-"}`
      + (sdk.error_message ? ` msg=${sdk.error_message}` : "")
      + (sdk.message ? ` (${sdk.message})` : ""),
    );
    if (sdk.call !== "ok") {
      parts.push("SDK báo không OK — Tevi có thể chưa hoàn tất thanh toán.");
    } else if (age > 10) {
      parts.push("SDK OK nhưng webhook chưa tới — kiểm tra Portal Topup + TEVI_WEBHOOK_SECRET + Worker Logs.");
    }
  } else {
    parts.push("Chưa có báo cáo SDK callback từ game.");
  }

  if (record.webhook_note) parts.push(record.webhook_note);
  if (!env.TOPUP_ORDERS) parts.push("Worker thiếu KV TOPUP_ORDERS.");
  if (!env.TEVI_WEBHOOK_SECRET) parts.push("Worker thiếu TEVI_WEBHOOK_SECRET (webhook có thể bị reject 401).");

  return parts.join(" ");
}

async function resolveOrderIdFromExchange(env, exchangeId) {
  if (!env.TOPUP_ORDERS || !exchangeId) return null;
  return env.TOPUP_ORDERS.get(exchangeKey(exchangeId));
}

/* ===================== VIDEO (giữ nguyên) ===================== */

async function hmacSign(secret, message) {
  return hmacSha256Hex(secret, message);
}

function isAllowedRewardFile(fileName) {
  return REWARD_FILE_RE.test(String(fileName || ""));
}

async function createVideoToken(request, env, workerOrigin) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  if (!env.VIDEO_SIGNING_SECRET) return json({ error: "Missing VIDEO_SIGNING_SECRET" }, 500, request, env);
  if (!env.VIDEOS) return json({ error: "Missing R2 binding VIDEOS" }, 500, request, env);
  const user = await verifyTeviUser(request, env);
  if (!user) return json({ error: "Unauthorized Tevi user" }, 401, request, env);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const fileName = String(body.file || env.ALLOWED_FILE || "").trim();
  if (!fileName || !isAllowedRewardFile(fileName)) {
    return json({ error: `Invalid file: ${fileName}` }, 400, request, env);
  }
  const ttl = Number(env.TOKEN_TTL_SECONDS || 600);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await hmacSign(env.VIDEO_SIGNING_SECRET, `${fileName}:${exp}`);
  const videoUrl = `${workerOrigin}/api/video?file=${encodeURIComponent(fileName)}&exp=${exp}&sig=${sig}`;
  return json({ videoUrl, expiresAt: exp }, 200, request, env);
}

async function serveVideo(request, env) {
  if (request.headers.get("Origin") && validateOrigin(request, env)) {
    return validateOrigin(request, env);
  }
  if (!env.VIDEO_SIGNING_SECRET || !env.VIDEOS) {
    return json({ error: "Video service misconfigured" }, 500, request, env);
  }
  const url = new URL(request.url);
  const fileName = String(url.searchParams.get("file") || "").trim();
  const exp = Number(url.searchParams.get("exp") || 0);
  const sig = String(url.searchParams.get("sig") || "");
  if (!fileName || !isAllowedRewardFile(fileName) || !exp || !sig) {
    return json({ error: "Invalid token params" }, 401, request, env);
  }
  if (Math.floor(Date.now() / 1000) > exp) return json({ error: "Token expired" }, 401, request, env);
  const expected = await hmacSign(env.VIDEO_SIGNING_SECRET, `${fileName}:${exp}`);
  if (expected !== sig) return json({ error: "Invalid signature" }, 401, request, env);
  const object = await env.VIDEOS.get(fileName);
  if (!object) return json({ error: `File not found: ${fileName}` }, 404, request, env);
  const headers = {
    "Content-Type": object.httpMetadata?.contentType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
    ...corsHeaders(request, env),
  };
  const range = request.headers.get("Range");
  if (range) {
    const size = object.size;
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) return new Response("Invalid Range", { status: 416, headers });
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : size - 1;
    const sliced = await env.VIDEOS.get(fileName, { range: { offset: start, length: end - start + 1 } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(request.method === "HEAD" ? null : sliced.body, { status: 206, headers });
  }
  headers["Content-Length"] = String(object.size);
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

/* ===================== TOP-UP SIGNATURE ===================== */

async function createTopUpSignature(request, env) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;

  const userAppToken = getBearer(request);
  if (!userAppToken) {
    return json({ success: false, message: "Missing user_app_token" }, 401, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const amount = Number(body.amount);
  const stars = Math.max(0, Math.floor(Number(body.stars) || 0));
  const packId = String(body.pack_id || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ success: false, message: "Invalid amount" }, 400, request, env);
  }

  const claims = decodeJwtPayload(userAppToken) || {};
  const userId = String(claims.user_id || claims.userId || claims.sub || claims.id || "").trim();
  if (!userId) {
    return json({ success: false, message: "Cannot decode user_id from token" }, 400, request, env);
  }

  const orderId = `ORD_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const appId = String(env.APP_ID || body.app_id || "SRB06792").trim();
  const teviBase = String(env.TEVI_API_BASE || "https://developer-api.sbx.tevi.dev").replace(/\/$/, "");
  const teviUrl = `${teviBase}/api/v1/payments/top-up-signature`;
  const teviBody = { amount, user_id: userId, order_id: orderId, app_id: appId };

  const teviRes = await fetch(teviUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAppToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(teviBody),
  });

  const teviRawText = await teviRes.text();
  let teviJson = {};
  try { teviJson = JSON.parse(teviRawText); } catch {
    teviJson = { success: false, message: `Tevi non-JSON HTTP ${teviRes.status}` };
  }

  if (teviRes.ok && teviJson.success !== false) {
    await saveOrder(env, {
      order_id: orderId,
      status: "pending",
      user_id: userId,
      app_id: appId,
      amount,
      stars,
      pack_id: packId,
      created_at: new Date().toISOString(),
      exchange_id: null,
    });
  }

  if (teviJson && typeof teviJson === "object") {
    teviJson.order_id = teviJson.order_id || orderId;
    teviJson.stars = stars;
    teviJson.debug = {
      worker_version: WORKER_VERSION,
      tevi_url: teviUrl,
      tevi_http_status: teviRes.status,
      tevi_body_sent: teviBody,
      auth_mode: "Bearer user_app_token",
      app_id: appId,
      user_id: userId,
      order_id: orderId,
      stars,
      pack_id: packId,
    };
  }

  return json(teviJson, teviRes.status, request, env);
}

/* ===================== TOP-UP STATUS (game poll) ===================== */

async function getTopUpStatus(request, env) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;

  const user = await verifyTeviUser(request, env);
  if (!user) return json({ success: false, message: "Unauthorized" }, 401, request, env);

  const orderId = new URL(request.url).searchParams.get("order_id") || "";
  if (!orderId.trim()) return json({ success: false, message: "Missing order_id" }, 400, request, env);

  const record = await loadOrder(env, orderId.trim());
  if (!record) {
    return json({
      success: true,
      status: "unknown",
      order_id: orderId,
      reason: "Order không tìm thấy trong KV — chưa bind TOPUP_ORDERS hoặc order hết hạn 24h.",
      hint: "Cloudflare → Worker → Bindings → KV variable TOPUP_ORDERS.",
      worker_version: WORKER_VERSION,
    }, 200, request, env);
  }

  const hint = record.status === "pending"
    ? buildPendingHint(record, env)
    : record.status === "paid"
      ? "Webhook user_topup đã xác nhận thanh toán."
      : (record.failure_reason || "Giao dịch thất bại.");

  return json({
    success: true,
    status: record.status,
    order_id: record.order_id,
    stars: record.stars,
    amount: record.amount,
    exchange_id: record.exchange_id,
    webhook_event: record.webhook_event,
    paid_at: record.paid_at,
    pending_seconds: orderAgeSeconds(record),
    sdk_callback: record.sdk_callback || null,
    webhook_note: record.webhook_note || null,
    reason: hint,
    hint,
    worker_version: WORKER_VERSION,
  }, 200, request, env);
}

async function reportTopUpSdkCallback(request, env) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;

  const user = await verifyTeviUser(request, env);
  if (!user) return json({ success: false, message: "Unauthorized" }, 401, request, env);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const orderId = String(body.order_id || "").trim();
  const sdkCallback = body.sdk_callback;
  if (!orderId || !sdkCallback || typeof sdkCallback !== "object") {
    return json({ success: false, message: "Missing order_id or sdk_callback" }, 400, request, env);
  }

  const existing = await loadOrder(env, orderId);
  if (!existing) {
    return json({ success: false, message: "Order not found", order_id: orderId }, 404, request, env);
  }

  const record = {
    ...existing,
    sdk_callback: sdkCallback,
    sdk_reported_at: new Date().toISOString(),
  };
  await saveOrder(env, record);

  return json({
    success: true,
    order_id: orderId,
    hint: buildPendingHint(record, env),
    worker_version: WORKER_VERSION,
  }, 200, request, env);
}

/* ===================== WEBHOOK (docs: X-Tevi-Signature) ===================== */

async function handleTeviWebhook(request, env) {
  const url = new URL(request.url);

  let challenge = url.searchParams.get("challenge");
  let payload = null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    const rawText = await request.text();
    if (!challenge && rawText) {
      try {
        payload = JSON.parse(rawText);
        if (payload?.challenge != null) challenge = String(payload.challenge);
      } catch {
        payload = null;
      }
    }
    if (!payload && rawText) {
      try { payload = JSON.parse(rawText); } catch { payload = { raw: rawText }; }
    }
  }

  if (challenge) {
    return new Response(String(challenge), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!payload) {
    return new Response(JSON.stringify({ success: false, message: "Empty webhook body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signature = request.headers.get("X-Tevi-Signature") || request.headers.get("x-tevi-signature");
  const secret = env.TEVI_WEBHOOK_SECRET || "";

  if (secret) {
    const valid = await verifyTeviWebhookSignature(payload, signature, secret);
    if (!valid) {
      console.warn("[TeviWebhook] Invalid signature", { hasSig: !!signature });
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    console.warn("[TeviWebhook] TEVI_WEBHOOK_SECRET not set — skipping verify (dev only)");
  }

  console.log("[TeviWebhook]", payload.event, JSON.stringify(payload));

  if (payload.event === "user_topup") {
    await processUserTopupWebhook(env, payload);
  }

  return new Response(JSON.stringify({ success: true, message: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function processUserTopupWebhook(env, payload) {
  const data = payload.data || {};
  const meta = data.metadata || {};
  const exchangeId = String(meta.exchange_id || meta.order_id || payload.id || "").trim();
  const userId = String(meta.user_id || data.user || "").trim();
  const amount = Number(data.amount);
  const appId = String(meta.app_id || env.APP_ID || "").trim();

  let orderId = null;
  if (exchangeId) {
    orderId = await resolveOrderIdFromExchange(env, exchangeId);
    if (!orderId && exchangeId.startsWith("ORD_")) orderId = exchangeId;
  }

  if (!orderId && env.TOPUP_ORDERS && userId) {
    // Fallback: tìm pending gần nhất cùng user (best-effort)
    const list = await env.TOPUP_ORDERS.list({ prefix: "order:" });
    for (const key of list.keys) {
      const rec = JSON.parse(await env.TOPUP_ORDERS.get(key.name));
      if (rec?.status === "pending" && `${rec.user_id}` === userId) {
        orderId = rec.order_id;
        break;
      }
    }
  }

  if (!orderId) {
    console.warn("[TeviWebhook] user_topup: no matching order", { exchangeId, userId });
    await saveOrphanWebhookNote(env, userId, exchangeId, payload);
    return;
  }

  const existing = await loadOrder(env, orderId);
  const record = {
    ...(existing || {}),
    order_id: orderId,
    status: "paid",
    exchange_id: exchangeId || existing?.exchange_id,
    user_id: userId || existing?.user_id,
    amount: Number.isFinite(amount) ? amount : existing?.amount,
    app_id: appId || existing?.app_id,
    webhook_event: "user_topup",
    webhook_id: payload.id,
    paid_at: payload.created_at || new Date().toISOString(),
  };
  await saveOrder(env, record);
}

/** Ghi chú lên order pending gần nhất khi webhook không khớp exchange_id. */
async function saveOrphanWebhookNote(env, userId, exchangeId, payload) {
  if (!env.TOPUP_ORDERS || !userId) return;
  const list = await env.TOPUP_ORDERS.list({ prefix: "order:" });
  for (const key of list.keys) {
    const rec = JSON.parse(await env.TOPUP_ORDERS.get(key.name));
    if (rec?.status === "pending" && `${rec.user_id}` === userId) {
      rec.webhook_note =
        `Webhook user_topup tới nhưng không khớp order (exchange_id=${exchangeId || "?"}). `
        + "Hỏi Tevi exchange_id có map order_id Worker không.";
      rec.last_webhook_id = payload.id;
      rec.last_webhook_at = payload.created_at || new Date().toISOString();
      await saveOrder(env, rec);
      return;
    }
  }
}
