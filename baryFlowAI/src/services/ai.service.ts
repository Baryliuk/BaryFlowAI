import OpenAI from "openai";
import { CONFIG } from "../config/env";
import { dbService } from "./db.service";

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

export const getAIRewrite = async (originalText: string, userId: number): Promise<string> => {
  const settings = dbService.getSettings(userId);
  const userPrompt = settings?.custom_prompt ?? null;

  // 1. Пошук ціни: від 250 до 3500 грн (щоб ігнорувати артикули типу 7801)
  const allNumbers = originalText.match(/\d{3,5}/g);
  const validPrices = allNumbers 
    ? allNumbers.map(Number).filter((n) => n >= 250 && n <= 3500) 
    : [];
  
  const originalPrice = validPrices.length > 0 ? Math.max(...validPrices) : 0;

  let finalPriceStr = "уточнюйте у Direct";
  if (originalPrice > 0) {
    let activeMargin: number;
    if (originalPrice <= 500) {
      activeMargin = 1.5; // +50%
    } else if (originalPrice <= 1000) {
      activeMargin = 1.35; // +35%
    } else {
      activeMargin = settings?.margin ?? 1.25; // Базова або дефолт
    }
    finalPriceStr = `${Math.round(originalPrice * activeMargin)} грн`;
  }

  const systemBase = userPrompt
    ? `Ти SMM-спеціаліст. Твоє завдання оформити пост: "${userPrompt}"`
    : `Ти топовий SMM преміальних магазинів. Стиль елітний, структура чітка.`;

  const finalInstructions = `
${systemBase}

### СУВОРІ ТЕХНІЧНІ ПРАВИЛА (ВИКОНУВАТИ БЕЗЗАПЕРЕЧНО):
1. **ФОРМАТ ВІДПОВІДІ**: Видавай ТІЛЬКИ текст поста. ЗАБОРОНЕНО будь-які вступні фрази ("Ось ваш пост", "Я виправив ціну"). Починай одразу з назви.
2. **ЦІНА ТОВАРУ**: Твоя єдина ціна — **${finalPriceStr}**. ЗАБОРОНЕНО використовувати ціни з вхідного тексту. 
3. **МОВА ТА ГРАМАТИКА**: Тільки правильна українська! Слідкуй за родами (Жіноче плаття, чоловіче худі).
4. **ФІЛЬТРАЦІЯ**: Видали всі посилання, @юзернейми та згадки про дроп/опт.
5. **ОБОВ'ЯЗКОВІ ХЕШТЕГИ**: В самому кінці додай:
#barylux #одягукраїна #купитиодягукраїна #інстамагазин #стильнийодяг
+ додай 3-4 релевантних до товару.

6. **ВІЗУАЛ**: Назва жирним КАПСОМ (через **), характеристики через ▫️.
`.trim();

  try {
    const res = await openai.chat.completions.create({
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: finalInstructions },
        { role: "user", content: originalText },
      ],
      temperature: 0.3,
    });

    let content = res.choices[0]?.message?.content ?? originalText;
    
    // Додатковий фікс: якщо ШІ все одно написав "Ось ваш пост", обрізаємо до першої зірочки
    if (content.includes("**") && content.indexOf("**") > 5) {
      content = content.substring(content.indexOf("**"));
    }

    return content;
  } catch (err: any) {
    console.error("🚨 AI Service error:", err.message);
    return originalText;
  }
};