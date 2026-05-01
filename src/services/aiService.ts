import { GoogleGenAI, Type } from "@google/genai";
import { SynthPreset } from "../types";

// The platform injects this into the environment for use with the Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateSynthPreset(prompt: string): Promise<Partial<SynthPreset>> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a music synthesizer preset for the following request: "${prompt}". 
    Focus on creating a high-quality sound profile with appropriate envelope and filter values.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          wave: { type: Type.STRING, enum: ["sine", "square", "sawtooth", "triangle"] },
          attack: { type: Type.NUMBER },
          decay: { type: Type.NUMBER },
          sustain: { type: Type.NUMBER },
          release: { type: Type.NUMBER },
          filter: { type: Type.NUMBER },
          fm: { type: Type.BOOLEAN },
          pwm: { type: Type.BOOLEAN },
          noise: { type: Type.BOOLEAN },
          detune: { type: Type.NUMBER },
          warp: { type: Type.NUMBER },
          reverb: { type: Type.NUMBER }
        },
        required: ["name", "wave", "attack", "decay", "sustain", "release", "filter"]
      }
    }
  });

  if (!response.text) {
    throw new Error("No response from AI");
  }

  return JSON.parse(response.text);
}

export async function suggestSampleName(duration: number, type: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Suggest a cool, short, one-word name for an audio sample that is ${duration.toFixed(2)} seconds long and recorded as a ${type}. Return just the name.`,
  });

  return response.text.trim().split(" ")[0].toUpperCase();
}

export async function generateDrumPattern(prompt: string): Promise<boolean[][]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a 16-step drum pattern for 16 tracks based on this request: "${prompt}".
    Return a 16x16 boolean grid where true means a hit.
    Format your response as a JSON object with a single field "pattern".`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pattern: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.BOOLEAN }
            }
          }
        },
        required: ["pattern"]
      }
    }
  });

  const data = JSON.parse(response.text);
  return data.pattern;
}
