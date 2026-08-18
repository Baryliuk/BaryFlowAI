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
 * Покращений витяг ціни з урахуванням контексту (пошук біля маркерів 'ціна', 'грн', '$' або окремих чисел)
 */
const extractOriginalPrice = (text: string): number => {
  // Пошук чисел у контексті цінових слів
  const priceRegex = /(?:ціна|вартість|коштує|грн|uah)?\s*[:\-]?\s*(\d{3,4})\s*(?:грн|uah)?/gi;
  const matches: number[] = [];

  let match: RegExpExecArray | null;
  while ((match = priceRegex.exec(text)) !== null) {
    const val = Number(match[1]);
    if (val >= 250 && val <= 3500) {
      matches.push(val);
    }
  }

  if (matches.length === 0) {
    // Фолбек: шукаємо будь-які числа у ціновому діапазоні
    const rawNumbers = text.match(/\b\d{3,4}\b/g);
    if (!rawNumbers) return 0;

    const valid = rawNumbers.map(Number).filter((n) => n >= 250 && n <= 3500);
    return valid.length > 0 ? Math.max(...valid) : 0;
  }

  return Math.max(...matches);
};

export const getAIRewrite = async (originalText: string, userId: number): Promise<string> => {
  const settings = dbService.getSettings(userId);
  const userPrompt = settings?.custom_prompt ?? null;

  const originalPrice = extractOriginalPrice(originalText);
  const finalPriceStr = originalPrice > 0 ? `${originalPrice + MARGIN_UAH} грн` : "уточнюйте у Direct";

  const systemBase = userPrompt
    ? `Ти SMM-спеціаліст. Твоє завдання оформити пост за інструкцією користувача: "${userPrompt}"`
    : `Ти топовий SMM преміальних магазинів одягу. Стиль елітний, структура чітка.`;

  // КЛЮЧОВИЙ ФІКС: Оскільки в draft.handler виводиться parse_mode: "HTML",
  // ми вимагаємо від ШІ саме HTML-теги (<b>назва</b>), а не Markdown (**назва**).
  const finalInstructions = `
${systemBase}

### СУВОРІ ТЕХНІЧНІ ПРАВИЛА (ВИКОНУВАТИ БЕЗЗАПЕРЕЧНО):
1. **ФОРМАТ ВІДПОВІДІ**: Видавай ТІЛЬКИ готовий текст поста. ЗАБОРОНЕНО будь-які вступні чи завершальні фрази ("Ось ваш пост", "Привіт"). Починай одразу з назви товару.
2. **ЦІНА ТОВАРУ**: Твоя єдина ціна для поста — ${finalPriceStr}. ЗАБОРОНЕНО використовувати інші ціни з вхідного тексту.
3. **МОВА ТА ГРАМАТИКА**: Тільки правильна українська! Слідкуй за узгодженням роду та відмінків (наприклад: жіноча сукня, чоловіче худі).
4. **ФІЛЬТРАЦІЯ**: Видали всі зовнішні посилання, @юзернейми та згадки про дроп, опт, поставки або склади.
5. **ФОРМАТУВАННЯ ТА HTML**:
   - Назва товару: <b>НАЗВА КАПСОМ</b> (використовуй ТІЛЬКИ HTML-тег <b>назва</b>, ніколи не використовуй зірочки **!).
   - Характеристики та розміри: оформлюй через символ ▫️.
   - Ціна: виділяй жирним через <b>${finalPriceStr}</b>.
6. **ОБОВ'ЯЗКОВІ ХЕШТЕГИ**: У самому кінці додай:
#barylux #одягукраїна #купитиодягукраїна #інстамагазин #стильнийодяг #чоловічийодяг
+ додай 3-4 тематичних хештеги, що відповідають товару.
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

    let content = res.choices[0]?.message?.content?.trim() ?? originalText;

    // Видаляємо випадкові вступні фрази від ШІ, якщо вони все ж проскочили
    if (/^(Ось|Привіт|Готово|Ваш пост)/i.test(content)) {
      const firstLineBreak = content.indexOf("\n");
      if (firstLineBreak !== -1) {
        content = content.substring(firstLineBreak + 1).trim();
      }
    }

    return content;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Невідома помилка AI";
    console.error("🚨 AI Service error:", errorMessage);
    return originalText;
  }
};