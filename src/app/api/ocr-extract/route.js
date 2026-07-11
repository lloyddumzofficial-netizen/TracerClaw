import { NextResponse } from "next/server";
import { createClient } from '@supabase/supabase-js';
import { validateUrlForSSRF } from "@/lib/ssrf";
import { safeRefundCredit } from "@/lib/supabase";
export async function POST(request) {
  try {
    const formData = await request.formData();
    const imageUrl = formData.get("imageUrl"); // Now always a URL

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image URL provided." },
        { status: 400 }
      );
    }

    if (!(await validateUrlForSSRF(imageUrl))) {
      return NextResponse.json({ error: "Invalid or unauthorized image URL (SSRF protection)" }, { status: 400 });
    }

    // 1. Auth & Billing Check
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check Credits
    const { data: profile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || profile.credits <= 0) {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }

    // Deduct Credit (Optimistic Lock)
    const { error: deductErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', user.id)
      .eq('credits', profile.credits)
      .select();

    if (deductErr || !updatedData || updatedData.length === 0) {
      return NextResponse.json({ error: "Billing error. Please try again." }, { status: 409 });
    }

    // 2. Process with Fal.ai (any-llm/vision via Claude 3.5 Sonnet)
    // The Gemini API key is dead, so we use the working FAL_KEY to route to a powerful VLM
    if (!process.env.FAL_KEY) {
      throw new Error("FAL_KEY is missing in environment variables.");
    }
    const { fal } = await import("@fal-ai/client");

    const prompt = `
      You are an expert OCR and data extraction system.
      Read all the handwritten or typed text in this image EXACTLY as written.
      CRITICAL INSTRUCTIONS:
      1. DO NOT autocorrect spellings. Even if a word is misspelled or blurry, output exactly the letters you see.
      2. Format the output STRICTLY as a JSON array of objects, where each object represents a row.
      3. Infer the column names from the header if it exists, otherwise use sensible column names like "Column1", "Column2", etc.
      4. Ensure you capture every row and column accurately. 
      5. Do not include markdown formatting or the word \`json\`. Just output the raw JSON array.
    `;

    const result = await fal.subscribe("fal-ai/any-llm/vision", {
      input: {
        model: "anthropic/claude-3.5-sonnet",
        image_url: imageUrl,
        prompt: prompt
      }
    });

    const responseText = result?.data?.output || "[]";
    
    let jsonData = [];
    try {
      // Safely extract only the JSON array part in case Claude added conversational text
      let cleanText = responseText;
      const match = cleanText.match(/\[[\s\S]*\]/);
      if (match) {
        cleanText = match[0];
      } else {
        // fallback to basic stripping
        cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "").trim();
      }
      
      jsonData = JSON.parse(cleanText);
    } catch (e) {
      console.error("Failed to parse JSON:", responseText);
      // Refund the credit if AI failed to return JSON
      await safeRefundCredit(user.id);
      return NextResponse.json({ error: "Failed to parse OCR results." }, { status: 500 });
    }

    // 3. Save History to DB
    const { error: dbError } = await adminSupabase
      .from('projects')
      .insert([
        { 
          name: 'OCR Extraction', 
          original_image_url: imageUrl,
          trace_type: 'ocr',
          svg_url: JSON.stringify(jsonData), // We abuse svg_url to store the stringified JSON data
          user_id: user.id
        }
      ]);

    if (dbError) {
      console.error("Failed to save OCR history:", dbError);
    }

    return NextResponse.json({ success: true, data: jsonData });
  } catch (error) {
    console.error("OCR Extraction Error:", error);
    return NextResponse.json(
      { error: error.message || error.toString() || "Failed to extract text. Please try again." },
      { status: 500 }
    );
  }
}
