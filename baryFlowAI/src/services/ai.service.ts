import OpenAI from "openai";
import { CONFIG } from "../config/env";
import { dbService } from "./db.service";

const REQUEST_TIMEOUT_MS = 20_000;

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
  timeout: REQUEST_TIMEOUT_MS,
});

/**
 * Розумний витяг ціни з урахуванням фільтрації артикулів та розмірів
 */
const extractOriginalPrice = (text: string): number => {
  // 1. Очищаємо текст від артикулів і кодів товару, щоб не зчитати "Арт 1200" як ціну
  const cleanText = text.replace(/(?:арт|артикул|код)\s*[:\.\-]?\s*\d+/gi, "");

  // 2. Пошук чисел біля цінових маркерів (ціна, вартість, грн, uah)
  const explicitPriceRegex =
    /(?:ціна|вартість|коштує|грн|uah|\$)\s*[:\-]?\s*(\d{3,4})|(\d{3,4})\s*(?:грн|uah|\$)/gi;
  const explicitMatches: number[] = [];

  let match: RegExpExecArray | null;
  while ((match = explicitPriceRegex.exec(cleanText)) !== null) {
    const val = Number(match[1] || match[2]);
    if (val >= 250 && val <= 4000) {
      explicitMatches.push(val);
    }
  }

  if (explicitMatches.length > 0) {
    return Math.max(...explicitMatches);
  }

  // 3. Фолбек: шукаємо будь-які окремі числа в розумному ціновому діапазоні
  const rawNumbers = cleanText.match(/\b\d{3,4}\b/g);
  if (!rawNumbers) return 0;

  const validNumbers = rawNumbers
    .map(Number)
    .filter((n) => n >= 250 && n <= 4000);

  return validNumbers.length > 0 ? Math.max(...validNumbers) : 0;
};

/**
 * Очищає текст від Markdown/HTML тегів та нормалізує переноси рядків для Instagram
 */
const cleanCaptionForInstagram = (text: string): string => {
  return text
    // Видаляємо випадкові Markdown зірочки (**заголовок** -> заголовок)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    // Видаляємо HTML-теги
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    // Розкручуємо подвійно заекрановані переноси рядків
    .replace(/\\n/g, "\n")
    // Видаляємо можливі вступні фрази від ШІ
    .replace(/^(Ось|Привіт|Готово|Ваш пост|Тримай|Згенеровано).*\n?/i, "")
    // Обмежуємо кількість підряд йдучих порожніх рядків до двох
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
  const finalPriceStr =
    originalPrice > 0
      ? `${originalPrice + 299} ГРН`
      : "ціну уточнюйте у Дірект";

  const systemBase = userPrompt
    ? `Ти SMM-спеціаліст. Твоє завдання оформити пост за правилами: "${userPrompt}"`
    : `Ти професійний SMM-копірайтер бренду одягу та аксесуарів BaryLux.`;

  const finalInstructions = `
${systemBase}

СУВОРІ ПРАВИЛА ФОРМАТУВАННЯ ДЛЯ INSTAGRAM (ВИКОНУВАТИ БЕЗЗАПЕРЕЧНО):

1. ЖОДНОГО MARKDOWN ТА HTML! ЗАБОРОНЕНО використовувати "**", "*", "_", "<b>", "<i>". Instagram показує їх як брудний текст!
2. НАЗВА ТОВАРУ: Перший рядок має бути БРЕНД І НАЗВА ТОВАРУ ВЕРХНІМ РЕГІСТРОМ (наприклад: BURBERRY ФУТБОЛКИ). Жодних зірочок чи тегів.
3. ХАРАКТЕРИСТИКИ: Кожен пункт списку починай СУВОРО зі спецсимволу "▪":
   ▪ Матеріал: [Матеріал]
   ▪ Розміри: [Розміри]
   ▪ Деталі: [Деталі/Опис]
4. ЦІНА: Рядок ціни має бути СУВОРО у форматі:
   💰 ${finalPriceStr}
5. ЗАКЛИК ДО ДІЇ:
   📫 Для замовлення пишіть у Дірект
6. ФІЛЬТРАЦІЯ: Повністю видали посилання, @юзернейми, номери телефонів, згадки про опт/дроп та вихідну ціну постачальника.
7. ХЕШТЕГИ: Наприкінці поста додай суворо ці хештеги через пробіл:
   #одягукраїна #інстамагазин #брендовийодяг #стильнийодяг #barylux #купитиодягукраїна
   (і додай 3-4 додаткових релевантних хештеги).
8. СТРУКТУРА: Між заголовком, списком, ціною, закликом та хештегами ОБО'ЯЗКОВО залишай ОДИН порожній рядок.
9. ВІДПОВІДЬ: Повертай ТІЛЬКИ готовий текст поста. Без вступних фраз ("Ось ваш пост") та коментарів.
`.trim();

  try {
    const res = await openai.chat.completions.create({
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: finalInstructions },
        { role: "user", content: originalText },
      ],
      temperature: 0.2,
    });

    const rawContent =
      res.choices[0]?.message?.content?.trim() ?? originalText;

    return cleanCaptionForInstagram(rawContent);
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Невідома помилка AI";
    console.error("🚨 AI Service error:", errorMessage);

    // У разі падіння API очищаємо хоча б сирий текст від HTML/Markdown
    return cleanCaptionForInstagram(originalText);
  }
};