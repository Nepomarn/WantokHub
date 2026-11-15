
import { verifySession } from "../_auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) {
    return Response.json(
      { success: false, loggedIn: false },
      { status: 500 }
    );
  }

  const loggedIn = await verifySession(
    request,
    env.SESSION_SECRET
  );

  return Response.json(
    { success: true, loggedIn },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
