export async function onRequestPost({ request, env }) {
  try {
    if (!env.GEMINI_API_KEY || !env.DB) {
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

    // 2. Prepare context prompt for Gemini
    const contextPrompt = `You are Wantok Assistant, a helpful AI career and education advisor for WantokHub in Papua New Guinea. 
You help students, job seekers, and professionals find jobs, scholarships, internships, and training opportunities based strictly on the current live database provided below. 
Be polite, concise, encouraging, and mention exact titles, organizations, deadlines, and provinces when relevant.

Current Live Opportunities Database:
${JSON.stringify(opportunities, null, 2)}

User Question: ${userMessage}`;

    // 3. Call Google Gemini API (Gemini 1.5 Flash)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    
    const aiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: contextPrompt }]
          }
        ]
      })
    });

    const aiData = await aiResponse.json();

    if (!aiResponse.ok) {
      // Return the exact error from Google Gemini for debugging
      const errorMessage = aiData.error?.message || "Failed to communicate with AI service.";
      return Response.json({ success: false, message: `Gemini Error: ${errorMessage}` }, { status: 500 });
    }

    const answer = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate an answer right now. Please try again.";

    return Response.json({
      success: true,
      reply: answer
    });

  } catch (error) {
    // Return the exact JavaScript error for debugging
    return Response.json(
      { success: false, message: `Server Error: ${error.message}` },
      { status: 500 }
    );
  }
}
