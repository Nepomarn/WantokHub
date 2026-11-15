
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
        created_at
      FROM opportunities
      WHERE status = 'published'
      ORDER BY created_at DESC
    `).all();

    return Response.json({
      success: true,
      count: result.results.length,
      opportunities: result.results
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Unable to load opportunities."
    }, { status: 500 });
  }
}
