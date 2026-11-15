
import { createSession } from "../_auth.js";

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes)
  );
}

function safeCompare(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return Response.json(
        { success: false, message: "Server security is not configured." },
        { status: 500 }
      );
    }

    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.includes("application/json")) {
      return Response.json(
        { success: false, message: "Invalid request." },
        { status: 415 }
      );
    }

    const body = await request.json();
    const password = body.password;

    if (typeof password !== "string" || password.length > 256) {
      return Response.json(
        { success: false, message: "Invalid password." },
        { status: 400 }
      );
    }

    const submittedHash = await hash(password);
    const correctHash = await hash(env.ADMIN_PASSWORD);

    if (!safeCompare(submittedHash, correctHash)) {
      return Response.json(
        { success: false, message: "Incorrect password." },
        { status: 401 }
      );
    }

    const session = await createSession(env.SESSION_SECRET);

    return Response.json(
      { success: true, message: "Login successful." },
      {
        headers: {
          "Set-Cookie":
            `wantokhub_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`,
          "Cache-Control": "no-store"
        }
      }
    );

  } catch {
    return Response.json(
      { success: false, message: "Unable to process login." },
      { status: 500 }
    );
  }
}
