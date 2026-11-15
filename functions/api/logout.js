
export async function onRequestPost() {
  return Response.json(
    {
      success: true,
      message: "You have been logged out."
    },
    {
      headers: {
        "Set-Cookie":
          "wantokhub_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0",
        "Cache-Control": "no-store"
      }
    }
  );
}
