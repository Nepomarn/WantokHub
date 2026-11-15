
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

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.DB) {
      return json({
        success: false,
        message: "Server security is not configured."
      }, 500);
    }

    if (!request.headers.get("Content-Type")?.includes("application/json")) {
      return json({
        success: false,
        message: "Invalid request."
      }, 415);
    }

    const body = await request.json();
    const password = body.password;

    if (
      typeof password !== "string" ||
      password.length > 256
    ) {
      return json({
        success: false,
        message: "Invalid password."
      }, 400);
    }

    // Use the connecting IP as the rate-limit key.
    const ip = request.headers.get("CF-Connecting-IP");

    if (!ip) {
      return json({
        success: false,
        message: "Unable to verify connection."
      }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 15 * 60;
    const maximumAttempts = 5;

    const existing = await env.DB.prepare(`
      SELECT attempts, window_started_at, blocked_until
      FROM admin_login_attempts
      WHERE ip_address = ?
    `).bind(ip).first();

    if (existing && existing.blocked_until > now) {
      return json({
        success: false,
        message: "Too many failed attempts. Try again later."
      }, 429, {
        "Retry-After": String(existing.blocked_until - now)
      });
    }

    const submittedHash = await hash(password);
    const correctHash = await hash(env.ADMIN_PASSWORD);

    if (!safeCompare(submittedHash, correctHash)) {
      let attempts = 1;
      let windowStartedAt = now;

      if (
        existing &&
        now - existing.window_started_at < windowSeconds
      ) {
        attempts = existing.attempts + 1;
        windowStartedAt = existing.window_started_at;
      }

      const blockedUntil =
        attempts >= maximumAttempts
          ? now + windowSeconds
          : 0;

      await env.DB.prepare(`
        INSERT INTO admin_login_attempts (
          ip_address,
          attempts,
          window_started_at,
          blocked_until
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ip_address) DO UPDATE SET
          attempts = excluded.attempts,
          window_started_at = excluded.window_started_at,
          blocked_until = excluded.blocked_until
      `).bind(
        ip,
        attempts,
        windowStartedAt,
        blockedUntil
      ).run();

      return json({
        success: false,
        message: blockedUntil
          ? "Too many failed attempts. Try again in 15 minutes."
          : "Incorrect password."
      }, blockedUntil ? 429 : 401);
    }

    // Clear failed attempts after a successful login.
    await env.DB.prepare(`
      DELETE FROM admin_login_attempts
      WHERE ip_address = ?
    `).bind(ip).run();

    const session = await createSession(env.SESSION_SECRET);

    return json({
      success: true,
      message: "Login successful."
    }, 200, {
      "Set-Cookie":
        `wantokhub_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`
    });

  } catch {
    return json({
      success: false,
      message: "Unable to process login."
    }, 500);
  }
}
