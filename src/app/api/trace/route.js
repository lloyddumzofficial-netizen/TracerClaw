import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const geminiApiKey = process.env.GEMINI_API_KEY;
const recraftApiKey = process.env.RECRAFT_API_KEY;

export const maxDuration = 60; // Allow more time for generation

export async function POST(request) {
  if (!geminiApiKey || !recraftApiKey) {
    return NextResponse.json(
      { error: "API keys are not configured properly in .env.local" },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image");

    if (!imageFile) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // 1. Process with Gemini Direct (Google AI Studio)
    console.log("Analyzing directly with Google Gemini 1.5 Pro...");
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const prompt = `
      You are an expert AI tracing and vectorization engine. Analyze this reference image provided by the user very carefully.
      Your goal is to instruct an image generator to re-trace this EXACT image.
      You must maintain 95% accuracy to the original shapes, layout, and composition. 
      Convert the design into a beautiful, high-quality, flat vector illustration.
      Provide a highly detailed, concise prompt describing the exact geometric shapes, positioning, intended solid colors, and the overall flat style to ensure the final output is a perfect, clean, and stunning flat image.
      Output ONLY the prompt text, nothing else.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: imageFile.type,
        },
      },
    ]);

    const geminiGeneratedPrompt = result.response.text().trim();
    console.log("Direct Google Prompt generated:", geminiGeneratedPrompt);

    // 2. Process with Recraft (Image-to-Image Generation)
    console.log("Generating vector with Recraft...");
    const recraftPayload = {
      prompt: geminiGeneratedPrompt,
      style: "vector_illustration",
      image: `data:${imageFile.type};base64,${base64Image}`
    };

    const recraftResponse = await fetch("https://external.api.recraft.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${recraftApiKey}`
      },
      body: JSON.stringify(recraftPayload)
    });

    if (!recraftResponse.ok) {
      const errorText = await recraftResponse.text();
      console.error("Recraft API Error:", errorText);
      return NextResponse.json({ error: "Failed to generate image from Recraft", details: errorText }, { status: recraftResponse.status });
    }

    const recraftData = await recraftResponse.json();
    
    // The response has { data: [{ url: "..." }] }
    const imageUrl = recraftData.data[0].url;
    console.log("Recraft Generation Successful:", imageUrl);

    return NextResponse.json({ 
      success: true, 
      prompt: geminiGeneratedPrompt,
      imageUrl: imageUrl 
    });

  } catch (error) {
    console.error("Error in trace route:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
