
import { verifySession } from "../../_auth.js";

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

const allowedStatuses = ["draft", "published"];

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

  return await verifySession(
    request,
    env.SESSION_SECRET
  );
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");

  return origin === new URL(request.url).origin;
}

async function readOpportunity(request) {
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

function validateOpportunity(data) {
  if (!data || typeof data !== "object") {
    return "Invalid information.";
  }

  const required = [
    "title",
    "organisation",
    "type",
    "province",
    "description"
  ];

  for (const field of required) {
    if (
      typeof data[field] !== "string" ||
      !data[field].trim()
    ) {
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

  if (!allowedTypes.includes(data.type)) {
    return "Invalid opportunity type.";
  }

  if (
    data.status !== undefined &&
    !allowedStatuses.includes(data.status)
  ) {
    return "Invalid publication status.";
  }

  for (const field of ["requirements", "deadline"]) {
    if (
      data[field] !== undefined &&
      data[field] !== null &&
      (typeof data[field] !== "string" || data[field].length > 2000)
    ) {
      return `Invalid ${field}.`;
    }
  }

  for (const field of ["application_url", "source_url"]) {
    if (data[field] !== undefined && data[field] !== "") {
      try {
        const url = new URL(data[field]);

        if (
          url.protocol !== "https:" ||
          data[field].length > 2000
        ) {
          return `${field} must be a valid HTTPS link.`;
        }
      } catch {
        return `${field} is not a valid link.`;
      }
    }
  }

  return null;
}

// View all opportunities, including drafts.
export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  try {
    const result = await env.DB.prepare(`
      SELECT *
      FROM opportunities
      ORDER BY created_at DESC
    `).all();

    return json({
      success: true,
      opportunities: result.results
    });

  } catch {
    return json({
      success: false,
      message: "Unable to load opportunities."
    }, 500);
  }
}

// Add a new opportunity.
export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const data = await readOpportunity(request);
  const error = validateOpportunity(data);

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
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.title.trim(),
      data.organisation.trim(),
      data.type,
      data.province.trim(),
      data.description.trim(),
      data.requirements || "",
      data.deadline || "",
      data.application_url || "",
      data.source_url || "",
      data.status || "draft"
    ).run();

    return json({
      success: true,
      message: "Opportunity added.",
      id: result.meta.last_row_id
    }, 201);

  } catch {
    return json({
      success: false,
      message: "Unable to add opportunity."
    }, 500);
  }
}

// Edit an existing opportunity.
export async function onRequestPut({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const data = await readOpportunity(request);
  const error = validateOpportunity(data);

  if (error) {
    return json({ success: false, message: error }, 400);
  }

  if (!Number.isInteger(data.id) || data.id < 1) {
    return json({ success: false, message: "Invalid opportunity ID." }, 400);
  }

  try {
    const result = await env.DB.prepare(`
      UPDATE opportunities
      SET
        title = ?,
        organisation = ?,
        type = ?,
        province = ?,
        description = ?,
        requirements = ?,
        deadline = ?,
        application_url = ?,
        source_url = ?,
        status = ?
      WHERE id = ?
    `).bind(
      data.title.trim(),
      data.organisation.trim(),
      data.type,
      data.province.trim(),
      data.description.trim(),
      data.requirements || "",
      data.deadline || "",
      data.application_url || "",
      data.source_url || "",
      data.status || "draft",
      data.id
    ).run();

    if (!result.meta.changes) {
      return json({
        success: false,
        message: "Opportunity not found."
      }, 404);
    }

    return json({
      success: true,
      message: "Opportunity updated."
    });

  } catch {
    return json({
      success: false,
      message: "Unable to update opportunity."
    }, 500);
  }
}

// Delete an opportunity.
export async function onRequestDelete({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!validOrigin(request)) {
    return json({ success: false, message: "Invalid request origin." }, 403);
  }

  const id = Number(new URL(request.url).searchParams.get("id"));

  if (!Number.isInteger(id) || id < 1) {
    return json({ success: false, message: "Invalid opportunity ID." }, 400);
  }

  try {
    const result = await env.DB.prepare(`
      DELETE FROM opportunities WHERE id = ?
    `).bind(id).run();

    if (!result.meta.changes) {
      return json({
        success: false,
        message: "Opportunity not found."
      }, 404);
    }

    return json({
      success: true,
      message: "Opportunity deleted."
    });

  } catch {
    return json({
      success: false,
      message: "Unable to delete opportunity."
    }, 500);
  }
}
