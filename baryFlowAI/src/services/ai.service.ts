import OpenAI from "openai";
import { CONFIG } from "../config/env";

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

export const getAIRewrite = async (text: string): Promise<string> => {
  const prompt = `Ти — топовий SMM Instagram-магазину одягу в Україні.
  
  ПРАВИЛА ОЧИЩЕННЯ:
  - Видали ВСІ юзернейми (@...) та посилання.
  Видаляй будь-які згадки про 'Дроп' або вхідну ціну. Залишай тільки фінальну ціну з націнкою і називай її 'Ціна' або 'Вартість'.
  
  МАТЕМАТИКА (КРИТИЧНО):
  - Знайди основну ціну. Якщо < 1000 грн -> +30%. Якщо >= 1000 грн -> +20%. Округли до цілого.
  
  ХЕШТЕГИ (ПРАВИЛА):
  - Згенеруй 7-10 релевантних хештегів.
  - ТІЛЬКИ правильною українською мовою (ніяких #спортивнаОдяг).
  - Обов'язково додай комерційні теги: #одягукраїна #купитизіпку (або назву товару) #чоловічийхотяг #інстамагазин.
  - ЖОДНИХ зайвих тегів (якщо це зіпка, не пиши #футболка).

  СТРУКТУРА:
  1. Заголовок (Назва товару)
  2. Характеристики (буліти)
  3. Розміри
  4. Ціна (нова, жирним шрифтом)
  5. "Для замовлення пишіть у Дірект 📥"
  6. Блок хештегів через пробіл.`;
  
  const res = await openai.chat.completions.create({
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `Текст: ${text}` },
    ],
    temperature: 0.1,
  });

  return res.choices[0].message.content || "";
};