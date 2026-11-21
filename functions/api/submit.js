const allowedOpportunityTypes = [
  "Job",
  "Scholarship",
  "Internship",
  "Training",
  "Apprenticeship",
  "Graduate Program",
  "Casual/Part-time",
  "Remote Job",
  "Education Grant"
];

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
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

function validateBusinessSubmission(data) {
  for (const field of ["business_name", "category", "description"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      return `Please provide ${field.replace(/_/g, " ")}.`;
    }
  }

  const permissionConfirmed =
    data.permission_confirmed === true ||
    data.permission_confirmed === 1 ||
    data.permission_confirmed === "1" ||
    data.permission_confirmed === "true" ||
    data.permission_confirmed === "on";

  if (!permissionConfirmed) {
    return "Please confirm permission to list this business.";
  }

  const maxLengths = {
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

  for (const [field, maxLen] of Object.entries(maxLengths)) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== "") {
      if (typeof data[field] !== "string" || data[field].length > maxLen) {
        return `Invalid ${field.replace(/_/g, " ")}.`;
      }
    }
  }

  for (const urlField of ["facebook_url", "website_url", "logo_url"]) {
    if (data[urlField] !== undefined && data[urlField] !== null && data[urlField] !== "") {
      if (
        typeof data[urlField] !== "string" ||
        data[urlField].length > 2000 ||
        !isHttpsUrl(data[urlField].trim())
      ) {
        return `${urlField.replace(/_/g, " ")} must use HTTPS.`;
      }
    }
  }

  return null;
}

function validateOpportunitySubmission(data) {
  for (const field of ["title", "organisation", "type", "province", "description"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      return `Please provide ${field}.`;
    }
  }

  if (
    data.title.length > 200 ||
    data.organisation.length > 200 ||
    data.province.length > 100 ||
    data.description.length > 5000
  ) {
    return "One or more fields are too long.";
  }

  if (!allowedOpportunityTypes.includes(data.type)) {
    return "Invalid opportunity type.";
  }

  for (const [field, maxLen] of Object.entries({
    requirements: 2000,
    deadline: 2000,
    source_name: 200
  })) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== "") {
      if (typeof data[field] !== "string" || data[field].length > maxLen) {
        return `Invalid ${field}.`;
      }
    }
  }

  for (const urlField of ["application_url", "source_url"]) {
    if (data[urlField] !== undefined && data[urlField] !== null && data[urlField] !== "") {
      if (
        typeof data[urlField] !== "string" ||
        data[urlField].length > 2000 ||
        !isHttpsUrl(data[urlField].trim())
      ) {
        return `${urlField} must use HTTPS.`;
      }
    }
  }

  return null;
}

async function handleBusiness(data, env) {
  const error = validateBusinessSubmission(data);
  if (error) {
    return json({ success: false, message: error }, 400);
  }

  try {
    const slug = await generateUniqueSlug(env.DB, data.business_name);

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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner', 'pending', 1, 0)
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
        data.submitted_by_phone?.trim() || null
      )
      .run();

    return json(
      {
        success: true,
        message: "Business submitted for review.",
        id: result.meta?.last_row_id ?? null,
        slug
      },
      201
    );
  } catch {
    return json(
      { success: false, message: "Unable to submit business." },
      500
    );
  }
}

async function handleOpportunity(data, env) {
  const error = validateOpportunitySubmission(data);
  if (error) {
    return json({ success: false, message: error }, 400);
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO opportunities (
        title,
        organisation,
        type,
        province,
        description,
        requirements,
        deadline,
        application_url,
        source_url,
        source_name,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `)
      .bind(
        data.title.trim(),
        data.organisation.trim(),
        data.type,
        data.province.trim(),
        data.description.trim(),
        data.requirements?.trim() || "",
        data.deadline?.trim() || "",
        data.application_url?.trim() || "",
        data.source_url?.trim() || "",
        data.source_name?.trim() || ""
      )
      .run();

    return json(
      {
        success: true,
        message: "Opportunity submitted for review.",
        id: result.meta?.last_row_id ?? null
      },
      201
    );
  } catch {
    return json(
      { success: false, message: "Unable to submit opportunity." },
      500
    );
  }
}

export async function onRequestPost({ request, env }) {
  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  if (!env.DB) {
    return json({ success: false, message: "Database is not configured." }, 500);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return json({ success: false, message: "Invalid content type." }, 400);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ success: false, message: "Invalid information." }, 400);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, message: "Invalid information." }, 400);
  }

  if (data.submission_type === "business" || data.kind === "business") {
    return handleBusiness(data, env);
  }

  return handleOpportunity(data, env);
}
