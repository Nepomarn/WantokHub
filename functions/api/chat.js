export async function onRequestPost({ request, env }) {
  try {
    // Validate that environment secrets and database bindings are present
    if (!env.OPENROUTER_API_KEY || !env.DB) {
      return Response.json(
        { success: false, message: "AI assistant is not configured on the server." },
        { status: 500 }
      );
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return Response.json(
        { success: false, message: "Invalid request format." },
        { status: 415 }
      );
    }

    const body = await request.json();
    const userMessage = body.message;

    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return Response.json(
        { success: false, message: "Please provide a message." },
        { status: 400 }
      );
    }

    // 1. Fetch current published, non-expired opportunities from the D1 database[span_0](start_span)[span_0](end_span)
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

    // 2. Build the system prompt with context from the live database
    const systemPrompt = `You are Wantok Assistant, a helpful AI career and education advisor for WantokHub in Papua New Guinea. 
You help students, job seekers, and professionals find jobs, scholarships, internships, and training opportunities based strictly on the current live database provided below. 
Be polite, concise, encouraging, and mention exact titles, organizations, deadlines, and provinces when relevant.

Current Live Opportunities Database:
${JSON.stringify(opportunities, null, 2)}`;

    // 3. Call OpenRouter API using a free model
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wantokhub.pages.dev", // Optional: Site URL for OpenRouter rankings
        "X-Title": "WantokHub" // Optional: App name for OpenRouter rankings
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage.trim() }
        ],
        temperature: 0.3
      })
    });

    if (!openRouterResponse.ok) {
      throw new Error("Failed to communicate with OpenRouter AI service.");
    }

    const aiData = await openRouterResponse.json();
    const answer = aiData.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate an answer right now. Please try again.";

    return Response.json({
      success: true,
      reply: answer
    }, {
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return Response.json(
      { success: false, message: "Unable to process your request at this time." },
      { status: 500 }
    );
  }
}
