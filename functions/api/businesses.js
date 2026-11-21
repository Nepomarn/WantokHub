function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return json(
      { success: false, message: "Database is not configured." },
      500
    );
  }

  const url = new URL(request.url);
  const province = (url.searchParams.get("province") || "").trim();
  const town = (url.searchParams.get("town") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const conditions = ["status = 'published'"];
  const params = [];

  if (province && province.toLowerCase() !== "all") {
    conditions.push("province = ?");
    params.push(province);
  }

  if (town && town.toLowerCase() !== "all") {
    conditions.push("town = ?");
    params.push(town);
  }

  if (category && category.toLowerCase() !== "all") {
    conditions.push("category = ?");
    params.push(category);
  }

  if (q) {
    conditions.push("(LOWER(business_name) LIKE ? OR LOWER(description) LIKE ?)");
    const pattern = `%${q}%`;
    params.push(pattern, pattern);
  }

  try {
    const sql = `
      SELECT
        id,
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
        is_verified,
        created_at,
        updated_at
      FROM businesses
      WHERE ${conditions.join(" AND ")}
      ORDER BY is_verified DESC, created_at DESC
    `;

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
