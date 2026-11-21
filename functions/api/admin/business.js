import { verifySession } from "../../_auth.js";

const allowedStatuses = ["pending", "draft", "published", "rejected"];
const allowedSources = ["admin", "owner"];

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;

  return await verifySession(request, env.SESSION_SECRET);
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await request.json();
  } catch {
    return null;
  }
}

function slugifyBusinessName(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return base || "business";
}

async function generateUniqueSlug(db, businessName) {
  const baseSlug = slugifyBusinessName(businessName);
  let candidate = baseSlug;
  let counter = 2;

  while (true) {
    const existing = await db
      .prepare("SELECT id FROM businesses WHERE slug = ? LIMIT 1")
      .bind(candidate)
      .first();

    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

function normalizeFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function validateHttpsUrl(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > 2000) {
    return `Invalid ${fieldLabel}.`;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") {
      return `${fieldLabel} must use HTTPS.`;
    }
  } catch {
    return `${fieldLabel} is not a valid link.`;
  }
  return null;
}

function validateBusiness(data, { isPartial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Invalid information.";
  }

  if (!isPartial) {
    for (const field of ["business_name", "category", "description"]) {
      if (typeof data[field] !== "string" || !data[field].trim()) {
        return `Please provide ${field.replace(/_/g, " ")}.`;
      }
    }
  }

  const textLimits = {
    business_name: 200,
    category: 120,
    description: 4000,
    province: 100,
    town: 100,
    address: 300,
    phone: 60,
    whatsapp: 60,
    email: 160,
    submitted_by_name: 160,
    submitted_by_email: 160,
    submitted_by_phone: 60
  };

  for (const [field, maxLen] of Object.entries(textLimits)) {
    if (data[field] !== undefined && data[field] !== null) {
      if (typeof data[field] !== "string" || data[field].length > maxLen) {
        return `Invalid ${field.replace(/_/g, " ")}.`;
      }
      if (
        !isPartial &&
        ["business_name", "category", "description"].includes(field) &&
        !data[field].trim()
      ) {
        return `Please provide ${field.replace(/_/g, " ")}.`;
      }
    }
  }

  if (data.status !== undefined && !allowedStatuses.includes(data.status)) {
    return "Invalid publication status.";
  }

  if (
    data.submission_source !== undefined &&
    !allowedSources.includes(data.submission_source)
  ) {
    return "Invalid submission source.";
  }

  for (const urlField of ["facebook_url", "website_url", "logo_url"]) {
    const urlError = validateHttpsUrl(data[urlField], urlField);
    if (urlError) return urlError;
  }

  return null;
}

// View all businesses across all statuses (including submitter details).
export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get("status") || "all").trim().toLowerCase();

  if (statusFilter !== "all" && !allowedStatuses.includes(statusFilter)) {
    return json({ success: false, message: "Invalid status filter." }, 400);
  }

  try {
    let sql = "SELECT * FROM businesses";
    const params = [];

    if (statusFilter !== "all") {
      sql += " WHERE status = ?";
      params.push(statusFilter);
    }

    sql += " ORDER BY created_at DESC";

    const result = await env.DB.prepare(sql).bind(...params).all();

    return json({
      success: true,
      businesses: result.results || []
    });
  } catch {
    return json(
      { success: false, message: "Unable to load businesses." },
      500
    );
  }
}

// Add a new business directly from the admin dashboard.
export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const data = await readJson(request);
  const error = validateBusiness(data, { isPartial: false });
  if (error) {
    return json({ success: false, message: error }, 400);
  }

  try {
    const slug = await generateUniqueSlug(env.DB, data.business_name);
    const status = data.status || "published";
    const isVerified = normalizeFlag(data.is_verified);
    const permissionConfirmed =
      data.permission_confirmed === undefined ? 1 : normalizeFlag(data.permission_confirmed);

    const result = await env.DB.prepare(`
      INSERT INTO businesses (
        business_name,
        slug,
        category,
        description,
        province,
        town,
        address,
        phone,
        whatsapp,
        email,
        facebook_url,
        website_url,
        logo_url,
        submitted_by_name,
        submitted_by_email,
        submitted_by_phone,
        submission_source,
        status,
        permission_confirmed,
        is_verified
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)
    `)
      .bind(
        data.business_name.trim(),
        slug,
        data.category.trim(),
        data.description.trim(),
        (typeof data.province === "string" && data.province.trim()) || "Morobe",
        (typeof data.town === "string" && data.town.trim()) || "Lae",
        data.address?.trim() || null,
        data.phone?.trim() || null,
        data.whatsapp?.trim() || null,
        data.email?.trim() || null,
        data.facebook_url?.trim() || null,
        data.website_url?.trim() || null,
        data.logo_url?.trim() || null,
        data.submitted_by_name?.trim() || null,
        data.submitted_by_email?.trim() || null,
        data.submitted_by_phone?.trim() || null,
        status,
        permissionConfirmed,
        isVerified
      )
      .run();

    return json(
      {
        success: true,
        message: "Business added.",
        id: result.meta?.last_row_id ?? null,
        slug
      },
      201
    );
  } catch {
    return json(
      { success: false, message: "Unable to add business." },
      500
    );
  }
}

// Quick moderation or full edit (supports status, is_verified, or any editable field).
async function handleUpdate({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const data = await readJson(request);
  const error = validateBusiness(data, { isPartial: true });
  if (error) {
    return json({ success: false, message: error }, 400);
  }

  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) {
    return json({ success: false, message: "Invalid business ID." }, 400);
  }

  const editableTextFields = [
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
    "submitted_by_name",
    "submitted_by_email",
    "submitted_by_phone"
  ];

  const updates = [];
  const params = [];

  for (const field of editableTextFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const cleaned = data[field] === null ? null : data[field].trim() || null;
      if (["business_name", "category", "description", "province", "town"].includes(field) && !cleaned) {
        return json(
          { success: false, message: `${field.replace(/_/g, " ")} cannot be empty.` },
          400
        );
      }
      updates.push(`${field} = ?`);
      params.push(cleaned);
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    updates.push("status = ?");
    params.push(data.status);
  }

  if (Object.prototype.hasOwnProperty.call(data, "is_verified")) {
    updates.push("is_verified = ?");
    params.push(normalizeFlag(data.is_verified));
  }

  if (Object.prototype.hasOwnProperty.call(data, "permission_confirmed")) {
    updates.push("permission_confirmed = ?");
    params.push(normalizeFlag(data.permission_confirmed));
  }

  if (updates.length === 0) {
    return json(
      { success: false, message: "No fields provided to update." },
      400
    );
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);

  try {
    const result = await env.DB.prepare(`
      UPDATE businesses
      SET ${updates.join(", ")}
      WHERE id = ?
    `)
      .bind(...params)
      .run();

    if (!result.meta?.changes) {
      return json({ success: false, message: "Business not found." }, 404);
    }

    const updated = await env.DB.prepare("SELECT * FROM businesses WHERE id = ?")
      .bind(id)
      .first();

    return json({
      success: true,
      message: "Business updated.",
      business: updated
    });
  } catch {
    return json(
      { success: false, message: "Unable to update business." },
      500
    );
  }
}

export async function onRequestPatch(context) {
  return handleUpdate(context);
}

export async function onRequestPut(context) {
  return handleUpdate(context);
}

// Delete a business.
export async function onRequestDelete({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) {
    return json({ success: false, message: "Invalid business ID." }, 400);
  }

  try {
    const result = await env.DB.prepare("DELETE FROM businesses WHERE id = ?")
      .bind(id)
      .run();

    if (!result.meta?.changes) {
      return json({ success: false, message: "Business not found." }, 404);
    }

    return json({
      success: true,
      message: "Business deleted."
    });
  } catch {
    return json(
      { success: false, message: "Unable to delete business." },
      500
    );
  }
}
