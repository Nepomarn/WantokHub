export async function onRequestPost({ request, env }) {
  try {
    if (!env.GROQ_API_KEY || !env.DB) {
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

    // 1. Fetch current published opportunities from D1 database
    const result = await env.DB.prepare(`
      SELECT title, organisation, type, province, description, requirements, deadline, application_url, source_name
      FROM opportunities
      WHERE status = 'published'
        AND (expiry_date IS NULL OR expiry_date = '' OR date(expiry_date) >= date('now', '+10 hours'))
      ORDER BY created_at DESC
    `).all();

    const opportunities = result.results || [];

    // 2. Prepare system prompt and user message for Groq
    const systemPrompt = `You are Wantok Assistant, a helpful AI career and education advisor for WantokHub in Papua New Guinea. 
You help students, job seekers, and professionals find jobs, scholarships, internships, and training opportunities based strictly on the current live database provided below. 
Be polite, concise, encouraging, and mention exact titles, organizations, deadlines, and provinces when relevant.

Current Live Opportunities Database:
${JSON.stringify(opportunities, null, 2)}`;

    // 3. Call Groq API (Using Llama 3.1 8B Instant)
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3
      })
    });

    if (!groqResponse.ok) {
      throw new Error("Failed to communicate with AI service.");
    }

    const aiData = await groqResponse.json();
    const answer = aiData.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate an answer right now. Please try again.";

    return Response.json({
      success: true,
      reply: answer
    });

  } catch (error) {
    return Response.json(
      { success: false, message: "Unable to process your request at this time." },
      { status: 500 }
    );
  }
}
