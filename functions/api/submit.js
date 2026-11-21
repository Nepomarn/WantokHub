const allowedTypes = [
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

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function isValidHttpsUrl(value, maxLength = 2000) {
  if (typeof value !== "string" || value.length > maxLength) {
    return { valid: false, message: "Invalid link format or length." };
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") {
      return { valid: false, message: "All links must start with https://" };
    }
    return { valid: true };
  } catch {
    return { valid: false, message: "Please enter a valid web link starting with https://" };
  }
}

function normalizePermission(val) {
  return val === true || val === 1 || val === "1" || val === "true" || val === "on";
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

function validateOpportunitySubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Invalid form data.";
  }

  // Honeypot field check (catches automated spam bots)
  if (data.website_url && data.website_url.trim() !== "") {
    return "Spam detected.";
  }

  const required = [
    "title",
    "organisation",
    "type",
    "province",
    "description",
    "source_name"
  ];

  for (const field of required) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      return `Please fill in the required field: ${field.replace("_", " ")}.`;
    }
  }

  if (
    data.title.length > 200 ||
    data.organisation.length > 200 ||
    data.province.length > 100 ||
    data.description.length > 5000 ||
    data.source_name.length > 200
  ) {
    return "One or more fields exceed the maximum allowed length.";
  }

  if (!allowedTypes.includes(data.type)) {
    return "Invalid opportunity type selected.";
  }

  const optionalTextLimits = {
    requirements: 2000,
    deadline: 200
  };

  for (const [field, maxLength] of Object.entries(optionalTextLimits)) {
    if (
      data[field] !== undefined &&
      data[field] !== null &&
      (typeof data[field] !== "string" || data[field].length > maxLength)
    ) {
      return `Invalid ${field}.`;
    }
  }

  if (data.expiry_date && data.expiry_date !== "") {
    if (
      typeof data.expiry_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.expiry_date)
    ) {
      return "Invalid expiry date format.";
    }
  }

  for (const field of ["application_url", "source_url"]) {
    if (data[field] && data[field].trim() !== "") {
      const check = isValidHttpsUrl(data[field], 2000);
      if (!check.valid) {
        return check.message;
      }
    }
  }

  return null;
}

function validateBusinessSubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Invalid form data.";
  }

  // Dedicated honeypot field so legitimate business website_url isn't blocked
  if (data._hp && String(data._hp).trim() !== "") {
    return "Spam detected.";
  }

  const required = ["business_name", "category", "description"];
  for (const field of required) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      return `Please fill in the required field: ${field.replace(/_/g, " ")}.`;
    }
  }

  if (!normalizePermission(data.permission_confirmed)) {
    return "You must confirm permission to list this business.";
  }

  const maxLengths = {
    business_name: 200,
    category: 120,
    description: 5000,
    province: 100,
    town: 100,
    address: 300,
    phone: 60,
    whatsapp: 60,
    email: 200,
    submitted_by_name: 200,
    submitted_by_email: 200,
    submitted_by_phone: 60
  };

  for (const [field, maxLen] of Object.entries(maxLengths)) {
    if (data[field] !== undefined && data[field] !== null) {
      if (typeof data[field] !== "string" || data[field].length > maxLen) {
        return `Invalid or overly long ${field.replace(/_/g, " ")}.`;
      }
    }
  }

  for (const urlField of ["facebook_url", "website_url", "logo_url"]) {
    if (data[urlField] && String(data[urlField]).trim() !== "") {
      const check = isValidHttpsUrl(String(data[urlField]), 2000);
      if (!check.valid) {
        return check.message;
      }
    }
  }

  return null;
}

async function handleOpportunityPost(db, data) {
  const validationError = validateOpportunitySubmission(data);
  if (validationError) {
    return json({ success: false, message: validationError }, 400);
  }

  // Insert into D1 database strictly as a 'draft' for admin review
  await db.prepare(`
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
      expiry_date,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).bind(
    data.title.trim(),
    data.organisation.trim(),
    data.type,
    data.province.trim(),
    data.description.trim(),
    (data.requirements || "").trim(),
    (data.deadline || "").trim(),
    (data.application_url || "").trim(),
    (data.source_url || "").trim(),
    data.source_name.trim(),
    (data.expiry_date || "").trim()
  ).run();

  return json({
    success: true,
    message: "Thank you! Your opportunity has been submitted and is pending admin review."
  }, 201);
}

async function handleBusinessPost(db, data) {
  const validationError = validateBusinessSubmission(data);
  if (validationError) {
    return json({ success: false, message: validationError }, 400);
  }

  const businessName = data.business_name.trim();
  const category = data.category.trim();
  const description = data.description.trim();
  const province = (data.province || "Morobe").trim() || "Morobe";
  const town = (data.town || "Lae").trim() || "Lae";
  const address = (data.address || "").trim() || null;
  const phone = (data.phone || "").trim() || null;
  const whatsapp = (data.whatsapp || "").trim() || null;
  const email = (data.email || "").trim() || null;
  const facebookUrl = (data.facebook_url || "").trim() || null;
  const websiteUrl = (data.website_url || "").trim() || null;
  const logoUrl = (data.logo_url || "").trim() || null;
  const submittedByName = (data.submitted_by_name || "").trim() || null;
  const submittedByEmail = (data.submitted_by_email || "").trim() || null;
  const submittedByPhone = (data.submitted_by_phone || "").trim() || null;

  const slug = await generateUniqueSlug(db, businessName);

  // Insert into D1 database as 'pending' with permission_confirmed = 1
  await db.prepare(`
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
  `).bind(
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
    submittedByPhone
  ).run();

  return json({
    success: true,
    slug,
    message: "Thank you! Your business has been submitted and is pending admin review."
  }, 201);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ success: false, message: "Database not configured." }, 500);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return json({ success: false, message: "Invalid request format." }, 415);
    }

    const data = await request.json();
    const kind = String(data?.submission_type || data?.kind || data?.entity_type || "")
      .trim()
      .toLowerCase();

    if (kind === "business") {
      return await handleBusinessPost(env.DB, data);
    }

    return await handleOpportunityPost(env.DB, data);
  } catch (error) {
    return json({
      success: false,
      message: "Unable to submit right now. Please try again later."
    }, 500);
  }
}
