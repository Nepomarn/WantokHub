
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSession(secret) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 28800
    }))
  );

  const key = await getHmacKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return payload + "." + toBase64Url(new Uint8Array(signature));
}

export async function verifySession(request, secret) {
  try {
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)wantokhub_session=([^;]+)/
    );

    if (!match) return false;

    const parts = match[1].split(".");
    if (parts.length !== 2) return false;

    const [payload, signature] = parts;
    const key = await getHmacKey(secret);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(payload)
    );

    if (!valid) return false;

    const session = JSON.parse(
      decoder.decode(fromBase64Url(payload))
    );

    return session.exp > Math.floor(Date.now() / 1000);

  } catch {
    return false;
  }
}
