import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const getSkincareAdvice = async (userQuery: string): Promise<string> => {
  if (!apiKey) {
    return "I'm sorry, I cannot provide consultation right now as the API key is missing. Please contact the front desk.";
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: userQuery,
      config: {
        systemInstruction: `You are 'Glow AI', a warm, professional, and knowledgeable esthetician at 'Glow Organic', a high-end organic skincare clinic. 
        
        Your Goal: Provide brief, helpful skincare advice based on organic principles and recommend one of our specific services if applicable.
        
        Our Services:
        1. The Organic Glow Facial ($120) - Best for dullness, dehydration, and maintenance.
        2. Lymphatic Sculpting ($145) - Best for puffiness, sculpting, and relaxation.
        3. Botanical Peel ($160) - Best for texture, fine lines, and uneven tone.

        Tone: Calming, luxurious, empathetic, and professional. Keep responses concise (under 80 words). Do not give medical advice.
        `,
        thinkingConfig: { thinkingBudget: 0 } // Low latency
      }
    });

    return response.text || "I'm having a little trouble connecting to the organic ether. Please ask again in a moment.";
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "I apologize, but I'm currently unable to process your request. Please try again later.";
  }
};