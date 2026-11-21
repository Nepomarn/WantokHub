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

function normalizePermission(val) {
  return (
    val === true ||
    val === 1 ||
    val === "1" ||
    val === "true" ||
    val === "on"
  );
}

export async function handleBusinessSubmission(request, env, preParsedBody = null) {
  const db = env.DB;
  if (!db) {
    return Response.json(
      { error: "Database binding (DB) is not configured." },
      { status: 500 }
    );
  }

  let body = preParsedBody;
  if (!body) {
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }
  }

  const businessName = String(body.business_name || "").trim();
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const province = String(body.province || "Morobe").trim() || "Morobe";
  const town = String(body.town || "Lae").trim() || "Lae";
  const address = String(body.address || "").trim() || null;
  const phone = String(body.phone || "").trim() || null;
  const whatsapp = String(body.whatsapp || "").trim() || null;
  const email = String(body.email || "").trim() || null;
  const facebookUrl = String(body.facebook_url || "").trim() || null;
  const websiteUrl = String(body.website_url || "").trim() || null;
  const logoUrl = String(body.logo_url || "").trim() || null;
  const submittedByName = String(body.submitted_by_name || "").trim() || null;
  const submittedByEmail = String(body.submitted_by_email || "").trim() || null;
  const submittedByPhone = String(body.submitted_by_phone || "").trim() || null;
  const permissionConfirmed = normalizePermission(body.permission_confirmed) ? 1 : 0;

  if (!businessName || !category || !description) {
    return Response.json(
      { error: "Business name, category, and description are required." },
      { status: 400 }
    );
  }

  if (!permissionConfirmed) {
    return Response.json(
      { error: "You must confirm permission to list this business." },
      { status: 400 }
    );
  }

  const slug = await generateUniqueSlug(db, businessName);

  const insertResult = await db
    .prepare(
      `INSERT INTO businesses (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner', 'pending', ?, 0)`
    )
    .bind(
      businessName,
      slug,
      category,
      description,
      province,
      town,
      address,
      phone,
      whatsapp,
      email,
      facebookUrl,
      websiteUrl,
      logoUrl,
      submittedByName,
      submittedByEmail,
      submittedByPhone,
      permissionConfirmed
    )
    .run();

  return Response.json(
    {
      ok: true,
      id: insertResult.meta?.last_row_id ?? null,
      slug,
      status: "pending",
      message: "Business submitted and awaiting admin review.",
    },
    { status: 201 }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const queryType = (url.searchParams.get("type") || "").trim().toLowerCase();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const submissionType = String(
    body.submission_type || body.kind || body.type || queryType || ""
  )
    .trim()
    .toLowerCase();

  if (submissionType === "business") {
    return handleBusinessSubmission(request, env, body);
  }

  // Opportunity submission fallback
  const db = env.DB;
  if (!db) {
    return Response.json(
      { error: "Database binding (DB) is not configured." },
      { status: 500 }
    );
  }

  const title = String(body.title || "").trim();
  const organisation = String(body.organisation || "").trim();
  const type = String(body.type || "opportunity").trim();
  const province = String(body.province || "Morobe").trim();
  const description = String(body.description || "").trim();
  const requirements = String(body.requirements || "").trim() || null;
  const deadline = String(body.deadline || "").trim() || null;
  const applicationUrl = String(body.application_url || "").trim() || null;
  const sourceUrl = String(body.source_url || "").trim() || null;
  const sourceName = String(body.source_name || "").trim() || null;
  const expiryDate = String(body.expiry_date || "").trim() || null;

  if (!title || !organisation || !type || !province || !description) {
    return Response.json(
      { error: "Title, organisation, type, province, and description are required." },
      { status: 400 }
    );
  }

  const insertResult = await db
    .prepare(
      `INSERT INTO opportunities (
        title,
        organisation,
        type,
        province,
        description,
        requirements,
        deadline,
        application_url,
        source_url,
        status,
        source_name,
        expiry_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .bind(
      title,
      organisation,
      type,
      province,
      description,
      requirements,
      deadline,
      applicationUrl,
      sourceUrl,
      sourceName,
      expiryDate
    )
    .run();

  return Response.json(
    {
      ok: true,
      id: insertResult.meta?.last_row_id ?? null,
      status: "draft",
      message: "Opportunity submitted and saved as draft.",
    },
    { status: 201 }
  );
}
