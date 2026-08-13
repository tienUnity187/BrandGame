const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    if (url.pathname === "/api/video-token" && request.method === "POST") {
      return createVideoToken(request, env, url.origin);
    }

    if (
      url.pathname === "/api/video" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return serveVideo(request, env, url);
    }

    // Không còn cho phép truy cập bằng ?file=...
    return new Response("Not found", { status: 404 });
  },
};

async function createVideoToken(request, env, workerOrigin) {
  const originError = validateOrigin(request, env);
  if (originError) return originError;

  const userId = await verifyTeviUser(request, env);
  if (!userId) {
    return json({ error: "Unauthorized Tevi user" }, 401, request, env);
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) +
    Number(env.TOKEN_TTL_SECONDS || 600);

  const payloadObject = {
    file: env.ALLOWED_FILE,
    userId,
    expiresAt,
  };

  const payload = bytesToBase64Url(
    encoder.encode(JSON.stringify(payloadObject)),
  );

  const signature = await sign(payload, env.VIDEO_SIGNING_SECRET);
  const token = 