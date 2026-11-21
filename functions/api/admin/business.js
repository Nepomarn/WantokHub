import { verifyAdminSession } from "../_auth.js";

const ALLOWED_STATUSES = new Set(["pending", "draft", "published", "rejected"]);

const EDITABLE_FIELDS = [
  "business_name",
  "category",
  "description",
  "province",
  "town",
  "address",
  "phone",
  "whatsapp",
  "email",
  "facebook_url",
  "website_url",
  "logo_url",
  "status",
  "is_verified",
];

function normalizeVerified(val) {
  return val === true || val === 1 || val === "1" || val === "true" ? 1 : 0;
}

async function requireAuth(context) {
  const auth = await verifyAdminSession(context);
  if (!auth || !auth.authenticated) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function onRequestGet(context) {
  const unauthorized = await requireAuth(context);
  if (unauthorized) return unauthorized;

  try {
    const db = context.env.DB;
    if (!db) {
      return Response.json(
        { error: "Database binding (DB) is not configured." },
        { status: 500 }
      );
    }

    const url = new URL(context.request.url);
    const statusParam = (url.searchParams.get("status") || "all").trim().toLowerCase();

    let sql = "SELECT * FROM businesses";
    const params = [];

    if (statusParam !== "all") {
      if (!ALLOWED_STATUSES.has(statusParam)) {
        return Response.json(
          { error: "Invalid status filter." },
          { status: 400 }
        );
      }
      sql += " WHERE status = ?";
      params.push(statusParam);
    }

    sql += " ORDER BY created_at DESC";

    const result = await db.prepare(sql).bind(...params).all();

    return Response.json({
      businesses: result.results || [],
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to load businesses for admin.", details: err.message },
      { status: 500 }
    );
  }
}

async function handleUpdate(context) {
  const unauthorized = await requireAuth(context);
  if (unauthorized) return unauthorized;

  try {
    const db = context.env.DB;
    if (!db) {
      return Response.json(
        { error: "Database binding (DB) is not configured." },
        { status: 500 }
      );
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        { error: "A valid numeric business id is required." },
        { status: 400 }
      );
    }

    const setClauses = [];
    const params = [];

    for (const field of EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;

      if (field === "status") {
        const nextStatus = String(body.status || "").trim().toLowerCase();
        if (!ALLOWED_STATUSES.has(nextStatus)) {
          return Response.json(
            { error: "Status must be pending, draft, published, or rejected." },
            { status: 400 }
          );
        }
        setClauses.push("status = ?");
        params.push(nextStatus);
      } else if (field === "is_verified") {
        setClauses.push("is_verified = ?");
        params.push(normalizeVerified(body.is_verified));
      } else {
        const val = body[field];
        const cleaned =
          val === null || val === undefined ? null : String(val).trim() || null;
        setClauses.push(`${field} = ?`);
        params.push(cleaned);
      }
    }

    if (setClauses.length === 0) {
      return Response.json(
        { error: "No valid fields provided to update." },
        { status: 400 }
      );
    }

    setClauses.push("updated_at = CURRENT_TIMESTAMP");

    const sql = `UPDATE businesses SET ${setClauses.join(", ")} WHERE id = ?`;
    params.push(id);

    const result = await db.prepare(sql).bind(...params).run();
    if ((result.meta?.changes ?? 0) === 0) {
      return Response.json({ error: "Business not found." }, { status: 404 });
    }

    const updated = await db
      .prepare("SELECT * FROM businesses WHERE id = ?")
      .bind(id)
      .first();

    return Response.json({
      ok: true,
      business: updated,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to update business.", details: err.message },
      { status: 500 }
    );
  }
}

export async function onRequestPatch(context) {
  return handleUpdate(context);
}

export async function onRequestPut(context) {
  return handleUpdate(context);
}

export async function onRequestDelete(context) {
  const unauthorized = await requireAuth(context);
  if (unauthorized) return unauthorized;

  try {
    const db = context.env.DB;
    if (!db) {
      return Response.json(
        { error: "Database binding (DB) is not configured." },
        { status: 500 }
      );
    }

    const url = new URL(context.request.url);
    let id = Number(url.searchParams.get("id"));

    if (!Number.isInteger(id) || id <= 0) {
      try {
        const body = await context.request.json();
        id = Number(body.id);
      } catch {
        // Ignore if body is empty
      }
    }

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        { error: "A valid numeric business id is required." },
        { status: 400 }
      );
    }

    const result = await db
      .prepare("DELETE FROM businesses WHERE id = ?")
      .bind(id)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return Response.json({ error: "Business not found." }, { status: 404 });
    }

    return Response.json({ ok: true, deleted_id: id });
  } catch (err) {
    return Response.json(
      { error: "Failed to delete business.", details: err.message },
      { status: 500 }
    );
  }
}
