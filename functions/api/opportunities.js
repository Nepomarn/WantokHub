
export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        id,
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
        date_checked,
        expiry_date,
        created_at
      FROM opportunities
      WHERE status = 'published'
        AND (
          expiry_date IS NULL
          OR expiry_date = ''
          OR date(expiry_date) >= date('now', '+10 hours')
        )
      ORDER BY created_at DESC
    `).all();

    const opportunities = result.results || [];

    return Response.json({
      success: true,
      count: opportunities.length,
      opportunities
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Unable to load opportunities."
    }, { status: 500 });
  }
}
