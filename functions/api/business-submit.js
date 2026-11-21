
const allowedCategories = [
  "Trades & Construction",
  "Automotive",
  "Food & Hospitality",
  "Retail",
  "Professional Services",
  "Health & Beauty",
  "Transport",
  "Agriculture",
  "Other"
];

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function cleanText(value, maxLength, required = false) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  if (required && !cleaned) return null;
  if (cleaned.length > maxLength) return null;

  return cleaned;
}

function validHttpsUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateBusiness(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Invalid submission information.";
  }

  // Hidden anti-spam field. Genuine visitors leave this empty.
  if (
    typeof data.website_url === "string" &&
    data.website_url.trim() !== ""
  ) {
    return "Unable to accept this submission.";
  }

  const businessName = cleanText(data.business_name, 150, true);
  const category = cleanText(data.category, 100, true);
  const description = cleanText(data.description, 3000, true);
  const address = cleanText(data.address || "", 300);
  const phone = cleanText(data.phone || "", 50);
  const whatsapp = cleanText(data.whatsapp || "", 50);
  const email = cleanText(data.email || "", 150);
  const facebook = cleanText(data.facebook_url || "", 500);
  const website = cleanText(data.business_website || "", 500);
  const logo = cleanText(data.logo_url || "", 500);

  const ownerName = cleanText(data.submitted_by_name, 150, true);
  const ownerEmail = cleanText(data.submitted_by_email || "", 150);
  const ownerPhone = cleanText(data.submitted_by_phone || "", 50);

  if (
    !businessName || !category || !description ||
    !ownerName || address === null ||
    phone === null || whatsapp === null ||
    email === null || facebook === null ||
    website === null || logo === null ||
    ownerEmail === null || ownerPhone === null
  ) {
    return "Please check your required fields and maximum text lengths.";
  }

  if (!allowedCategories.includes(category)) {
    return "Please select a valid business category.";
  }

  if (description.length < 20) {
    return "Please provide a business description of at least 20 characters.";
  }

  if (!phone && !whatsapp && !email && !facebook) {
    return "Please provide at least one public business contact method.";
  }

  if (!ownerEmail && !ownerPhone) {
    return "Please provide your own email address or phone number so we can contact you about your submission.";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    (email && !emailPattern.test(email)) ||
    (ownerEmail && !emailPattern.test(ownerEmail))
  ) {
    return "Please enter a valid email address.";
  }

  for (const url of [facebook, website, logo]) {
    if (!validHttpsUrl(url)) {
      return "Facebook, website and logo links must be valid HTTPS links.";
    }
  }

  if (data.permission_confirmed !== true) {
    return "Please confirm that you have permission to submit these business details for publication.";
  }

  return null;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        message: "Database is not configured."
      }, 500);
    }

    // Accept requests only from this website.
    const origin = request.headers.get("Origin");

    if (!origin || origin !== new URL(request.url).origin) {
      return json({
        success: false,
        message: "Invalid request origin."
      }, 403);
    }

    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.includes("application/json")) {
      return json({
        success: false,
        message: "Invalid request format."
      }, 415);
    }

    const contentLength = Number(
      request.headers.get("Content-Length") || 0
    );

    if (contentLength > 20000) {
      return json({
        success: false,
        message: "Submission is too large."
      }, 413);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return json({
        success: false,
        message: "Invalid submission data."
      }, 400);
    }

    const validationError = validateBusiness(data);

    if (validationError) {
      return json({
        success: false,
        message: validationError
      }, 400);
    }

    const businessName = data.business_name.trim();
    const slugBase = businessName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "business";

    const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;

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
      VALUES (
        ?, ?, ?, ?, 'Morobe', 'Lae', ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 'owner', 'pending', 1, 0
      )
    `).bind(
      data.business_name.trim(),
      slug,
      data.category,
      data.description.trim(),
      (data.address || "").trim(),
      (data.phone || "").trim(),
      (data.whatsapp || "").trim(),
      (data.email || "").trim(),
      (data.facebook_url || "").trim(),
      (data.business_website || "").trim(),
      (data.logo_url || "").trim(),
      data.submitted_by_name.trim(),
      (data.submitted_by_email || "").trim(),
      (data.submitted_by_phone || "").trim()
    ).run();

    return json({
      success: true,
      message: "Thank you! Your business has been submitted successfully. It is now waiting for WantokHub admin review.",
      id: result.meta.last_row_id
    }, 201);

  } catch (error) {
    return json({
      success: false,
      message: "Unable to submit your business right now. Please try again later."
    }, 500);
  }
}
