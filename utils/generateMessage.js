require("dotenv").config();
const OpenAI = require("openai");

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

async function generateBirthdayMessage(lines = []) {
  const prompt = `Skriv en kort, varm bursdagshilsen på norsk til disse:\n${lines.join("\n")}`;

  if (OPENROUTER_KEY) {
    try {
      const client = new OpenAI({
        apiKey: OPENROUTER_KEY,
        baseURL: "https://openrouter.ai/api/v1",  // 🔑 Important
      });

      // Choose any available model, e.g. Gemini, Claude, GPT, Mistral
      const resp = await client.chat.completions.create({
        model: "tngtech/deepseek-r1t2-chimera:free",   // 👈 try also "anthropic/claude-3-haiku" etc.
        messages: [{ role: "user", content: prompt }],
      });

      return resp.choices[0].message.content;
    } catch (err) {
      console.error("OpenRouter API call failed:", err);
    }
  }

  // fallback
  return lines.map(l => `🎉 ${l} — Ha en flott dag!`).join("\n");
}

module.exports = { generateBirthdayMessage };
