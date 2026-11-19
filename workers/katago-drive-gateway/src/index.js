const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files/";

function b64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && tokenCache.expiresAt > now + 60) return tokenCache.value;

  if (!env.DRIVE_SERVICE_ACCOUNT_EMAIL || !env.DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Gateway is missing Drive service-account secrets");
  }

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: env.DRIVE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + b64url(new Uint8Array(signature));

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Google OAuth token request failed: " + response.status);
  const data = await response.json();
  tokenCache = { value: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return tokenCache.value;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
    "Vary": "Origin"
  };
}

function responseWithCors(body, status, headers = {}) {
  return new Response(body, { status, headers: { ...corsHeaders(), ...headers } });
}

async function handleModel(request, env, fileId, modelName) {
  if (!fileId) return responseWithCors("Model file ID is not configured", 503);
  const token = await getAccessToken(env);
  const headers = { Authorization: "Bearer " + token };

  if (request.method === "HEAD") {
    const metaUrl = DRIVE_API + encodeURIComponent(fileId) +
      "?fields=id%2Cname%2Csize%2CmimeType%2Cmd5Checksum%2Ccapabilities%28canDownload%29";
    const metaResponse = await fetch(metaUrl, { headers: { Authorization: headers.Authorization } });
    if (!metaResponse.ok) return responseWithCors("Google Drive metadata request failed", metaResponse.status);
    const meta = await metaResponse.json();
    if (meta.capabilities && meta.capabilities.canDownload === false) {
      return responseWithCors("Drive file is not downloadable by the service account", 403);
    }
    return responseWithCors(null, 200, {
      "Content-Type": meta.mimeType || "application/octet-stream",
      ...(meta.size ? { "Content-Length": String(meta.size) } : {}),
      "Accept-Ranges": "bytes",
      ...(meta.md5Checksum ? { "ETag": '"' + meta.md5Checksum + '"' } : {}),
      "Cache-Control": "public, max-age=300"
    });
  }

  if (request.headers.has("Range")) headers.Range = request.headers.get("Range");
  const upstream = await fetch(DRIVE_API + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true", {
    method: "GET",
    headers,
    redirect: "follow"
  });

  const outHeaders = new Headers(corsHeaders());
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  outHeaders.set("Cache-Control", "public, max-age=86400");
  outHeaders.set("X-KataGo-Model", modelName);
  if (!outHeaders.has("Content-Type")) outHeaders.set("Content-Type", "application/octet-stream");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return responseWithCors(null, 204, { "Access-Control-Max-Age": "86400" });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return responseWithCors("Method not allowed", 405, { Allow: "GET, HEAD, OPTIONS" });
    }

    const routes = {
      "/model/desktop": { id: env.DRIVE_FILE_ID_DESKTOP, name: "TF3-B11C768" },
      "/model/mobile": { id: env.DRIVE_FILE_ID_MOBILE, name: "TF3-B10C128" }
    };
    const model = routes[url.pathname];
    if (!model) return responseWithCors("Not found", 404);

    try {
      return await handleModel(request, env, model.id, model.name);
    } catch (error) {
      return responseWithCors("Gateway error: " + (error?.message || String(error)), 502);
    }
  }
};
