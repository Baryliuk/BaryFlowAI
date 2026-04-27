import OpenAI from "openai";
import { CONFIG } from "../config/env";
import { dbService } from "./db.service";

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

export const getAIRewrite = async (originalText: string, userId: number): Promise<string> => {
  const settings = dbService.getSettings(userId);
  const userPrompt = settings?.custom_prompt;

  // 1. Пошук ціни (беремо найбільше число > 200, щоб не вхопити артикул чи розмір)
  const allNumbers = originalText.match(/\d{3,5}/g);
  const validPrices = allNumbers ? allNumbers.map(Number).filter(n => n > 200) : [];
  const originalPrice = validPrices.length > 0 ? Math.max(...validPrices) : 0;
  
  let finalPriceStr = "уточнюйте у Direct";
  if (originalPrice > 0) {
    const margin = originalPrice < 1000 ? 1.3 : 1.2;
    finalPriceStr = `${Math.round(originalPrice * margin)} грн`;
  }

  // 2. Формуємо промпт
  const systemBase = userPrompt 
    ? `Ти SMM-спеціаліст. Оформи пост за вказівкою клієнта: "${userPrompt}"`
    : `Ти топовий SMM преміальних магазинів. Використовуй елітний стиль, ▫️ для списку, назву жирним.`;

  const finalInstructions = `
${systemBase}

ОБОВ'ЯЗКОВІ ТЕХНІЧНІ ПРАВИЛА:
- ЦІНА ДЛЯ ПОСТА: **${finalPriceStr}** (Встав її саме так).
- Очищення: Видали всі посилання, @юзернейми та згадки про "дроп/опт".
- Мова: Українська.
- Хештеги: 7-10 релевантних у кінці.
`;

  const res = await openai.chat.completions.create({
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "system", content: finalInstructions },
      { role: "user", content: originalText },
    ],
    temperature: 0.3,
  });

  return res.choices[0].message.content || "";
};