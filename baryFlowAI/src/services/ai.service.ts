import OpenAI from "openai";
import { CONFIG } from "../config/env";
import { dbService } from "./db.service";

const MARGIN_UAH = 299;
const REQUEST_TIMEOUT_MS = 20_000;

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
  timeout: REQUEST_TIMEOUT_MS,
});

/**
 * Точний витяг ціни постачальника (зокрема із "ДРОП 1150 ГРН", "ОПТ", "Ціна: 1150" тощо)
 */
const extractOriginalPrice = (text: string): number => {
  // 1. Прибираємо артикули, щоб "Арт 1200" не зчиталося як ціна
  const cleanText = text.replace(/(?:арт|артикул|код)\s*[:\.\-]?\s*\d+/gi, "");

  // 2. Пошук цінових маркерів (включаючи ДРОП, ОПТ, ГРН, UAH)
  const priceRegex =
    /(?:ціна|вартість|коштує|дроп|опт|гурт|грн|uah|\$)\s*[:\.\-—]?\s*(\d{3,4})|(\d{3,4})\s*(?:грн|uah|\$|дроп|опт)/gi;

  const matches: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = priceRegex.exec(cleanText)) !== null) {
    const val = Number(match[1] || match[2]);
    if (val >= 250 && val <= 4000) {
      matches.push(val);
    }
  }

  if (matches.length > 0) {
    // Якщо знайшли кілька цін — беремо найменшу як базу для дропу
    return Math.min(...matches);
  }

  // 3. Фолбек: шукаємо будь-які окремі числа в діапазоні 250-4000
  const rawNumbers = cleanText.match(/\b\d{3,4}\b/g);
  if (!rawNumbers) return 0;

  const validNumbers = rawNumbers
    .map(Number)
    .filter((n) => n >= 250 && n <= 4000);

  return validNumbers.length > 0 ? Math.min(...validNumbers) : 0;
};

/**
 * Очищає опис від службового сміття постачальників, HTML/Markdown тегів та нормалізує переноси
 */
const cleanCaptionForInstagram = (text: string): string => {
  return text
    // Видаляємо Markdown зірочки
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    // Видаляємо HTML-теги
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    // Розкручуємо \\n
    .replace(/\\n/g, "\n")
    // Видаляємо можливі вступні фрази від ШІ
    .replace(/^(Ось|Привіт|Готово|Ваш пост|Тримай|Згенеровано).*\n?/i, "")
    // Підстраховка: програмно видаляємо рядки зі сміттям постачальника, якщо ШІ їх пропустив
    .split("\n")
    .filter((line) => {
      const l = line.toLowerCase();
      return (
        !l.includes("менеджер") &&
        !l.includes("crm") &&
        !l.includes("заміри в коментарях") &&
        !l.includes("фото файлом") &&
        !l.includes("таблиця наявності") &&
        !l.includes("дроп") &&
        !l.includes("опт")
      );
    })
    .join("\n")
    // Ограничуємо підряд йдучі порожні рядки
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const getAIRewrite = async (
  originalText: string,
  userId: number
): Promise<string> => {
  const settings = dbService.getSettings(userId);
  const userPrompt = settings?.custom_prompt ?? null;

  const originalPrice = extractOriginalPrice(originalText);
  // Автоматично додаємо націнку +299 грн
  const finalPrice = originalPrice > 0 ? originalPrice + MARGIN_UAH : 0;
  const finalPriceStr =
    finalPrice > 0 ? `${finalPrice} ГРН` : "ціну уточнюйте у Дірект";

  const systemBase = userPrompt
    ? `Ти SMM-спеціаліст. Оформи пост за правилами: "${userPrompt}"`
    : `Ти професійний SMM-копірайтер бренду одягу та аксесуарів BaryLux.`;

  const finalInstructions = `
${systemBase}

СУВОРІ ПРАВИЛА ФОРМАТУВАННЯ ТА ОЧИЩЕННЯ (ВИКОНУВАТИ БЕЗЗАПЕРЕЧНО):

1. **ЦІНА З НАЦІНКУ**: Твоя ЄДИНА ціна для поста — **${finalPriceStr}**.
   - Повністю ЗАБОРОНЕНО використовувати вихідні ціни постачальника.
   - Слово "ДРОП", "ОПТ", "ДРОП ЦІНА" КАТЕГОРИЧНО ЗАБОРОНЕНО. Виводь ТІЛЬКИ рядок: 💰 ${finalPriceStr}

2. **ПОВНЕ ВИДАЛЕННЯ СМІТТЯ ПОСТАЧАЛЬНИКА**:
   - Повністю ВИДАЛИ рядки про менеджера (✏️ МЕНЕДЖЕР, контакти Telegram тощо).
   - Повністю ВИДАЛИ згадки CRM, таблиць наявності (✍️ ТАБЛИЦЯ НАЯВНОСТІ В CRM).
   - Повністю ВИДАЛИ фрази типу "Фото файлом та заміри в коментарях👇".
   - Видали всі телеграм-посилання, @юзернейми, номери телефонів та службові примітки.

3. **ЖОДНОГО MARKDOWN ТА HTML**: НІЯКИХ "**", "*", "<b>", "<i>". Instagram їх не підтримує!

4. **ФОРМАТ ПОСТА (СУВОРО ЗА ШАБЛОНОМ)**:
   [БРЕНД І НАЗВА ТОВАРУ ВЕРХНІМ РЕГІСТРОМ]

   ▪ Матеріал: [Матеріал]
   ▪ Розміри: [Розміри]
   ▪ Деталі: [Деталі/Опис]

   💰 ${finalPriceStr}

   📫 Для замовлення пишіть у Дірект

   #одягукраїна #інстамагазин #брендовийодяг #стильнийодяг #barylux #купитиодягукраїна

5. **ВІДПОВІДЬ**: Видавай ТІЛЬКИ чистий текст поста. Без вступних фраз ("Ось готовий пост").
`.trim();

  try {
    const res = await openai.chat.completions.create({
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: finalInstructions },
        { role: "user", content: originalText },
      ],
      temperature: 0.1, // Низька температура для суворого дотримання ціни та інструкцій
    });

    const rawContent =
      res.choices[0]?.message?.content?.trim() ?? originalText;

    return cleanCaptionForInstagram(rawContent);
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Невідома помилка AI";
    console.error("🚨 AI Service error:", errorMessage);

    return cleanCaptionForInstagram(originalText);
  }
};