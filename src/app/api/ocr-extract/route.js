import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminSupabase } from "@/lib/supabase";

export async function POST(request) {
  let userId = null;
  let creditDeducted = false;
  let originalCredits = null;

  try {
    const formData = await request.formData();
    const imageUrl = formData.get("imageUrl");

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image URL provided." },
        { status: 400 }
      );
    }

    // 1. Auth & Billing Check — use shared adminSupabase singleton
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;

    // Check Credits
    const { data: profile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profile || profile.credits <= 0) {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }
    originalCredits = profile.credits;

    // Deduct Credit (Optimistic Lock)
    const { error: deductErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();

    if (deductErr || !updatedData || updatedData.length === 0) {
      return NextResponse.json({ error: "Billing error. Please try again." }, { status: 409 });
    }
    creditDeducted = true;

    // 2. Process with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-image" });

    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    };

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

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text();
    let jsonData = [];
    try {
      let cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      jsonData = JSON.parse(cleanText);
    } catch (e) {
      console.error("Failed to parse JSON:", responseText);
      // Refund the credit if AI failed to return valid JSON
      await adminSupabase.from('profiles').update({ credits: originalCredits }).eq('id', userId);
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
          svg_url: JSON.stringify(jsonData), // Reuse svg_url column to store stringified JSON
          user_id: userId
        }
      ]);

    if (dbError) {
      console.error("Failed to save OCR history:", dbError);
    }

    return NextResponse.json({ success: true, data: jsonData });

  } catch (error) {
    console.error("OCR Extraction Error:", error);

    // Refund credit on any unexpected failure — covers Gemini network errors, quota exceeded, etc.
    if (creditDeducted && userId && originalCredits !== null) {
      try {
        await adminSupabase.from('profiles').update({ credits: originalCredits }).eq('id', userId);
        console.log(`[OCR] Credit refunded for user ${userId} due to error.`);
      } catch (refundErr) {
        console.error("[OCR] Refund failed:", refundErr.message);
      }
    }

    return NextResponse.json(
      { error: error.message || error.toString() || "Failed to extract text. Please try again." },
      { status: 500 }
    );
  }
}
