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

function validateSubmission(data) {
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
      if (typeof data[field] !== "string" || data[field].length > 2000) {
        return `Invalid ${field}.`;
      }
      try {
        const url = new URL(data[field].trim());
        if (url.protocol !== "https:") {
          return "All links must start with https://";
        }
      } catch {
        return "Please enter a valid web link starting with https://";
      }
    }
  }

  return null;
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
    const validationError = validateSubmission(data);

    if (validationError) {
      return json({ success: false, message: validationError }, 400);
    }

    // Insert into D1 database strictly as a 'draft' for admin review
    await env.DB.prepare(`
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

  } catch (error) {
    return json({
      success: false,
      message: "Unable to submit opportunity right now. Please try again later."
    }, 500);
  }
}
