import OpenAI from "openai";
import { CONFIG } from "../config/env";
import { dbService } from "./db.service";

const MARGIN_UAH = 299;
const REQUEST_TIMEOUT_MS = 45_000; // 45 секунд для стабільної відповіді

const openai = new OpenAI({
  apiKey: CONFIG.NVIDIA_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
  timeout: REQUEST_TIMEOUT_MS,
});

/**
 * Очищає опис від службового сміття постачальників, HTML/Markdown тегів та нормалізує переноси
 */
const cleanCaptionForInstagram = (text: string): string => {
  return text
    // Видаляємо Markdown зірочки та підкреслення
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
    // Програмний фільтр: видаляємо службові рядки постачальника, якщо ШІ їх випадково пропустив
    .split("\n")
    .filter((line) => {
      const l = line.toLowerCase();
      return (
        !l.includes("менеджер") &&
        !l.includes("crm") &&
        !l.includes("заміри в коментарях") &&
        !l.includes("фото файлом") &&
        !l.includes("таблиця наявності") &&
        !l.startsWith("арт") &&
        !l.includes("арт -")
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const getAIRewrite = async (
  originalText: string,
  userId: number
): Promise<string> => {
  const settings = dbService.getSettings(userId);
  const userPrompt = settings?.custom_prompt ?? null;

  const systemBase = userPrompt
    ? `Ти SMM-спеціаліст. Оформи пост за правилами: "${userPrompt}"`
    : `Ти професійний SMM-копірайтер бренду одягу та аксесуарів BaryLux.`;

  const finalInstructions = `
${systemBase}

ТВОЄ ГОЛОВНЕ ЗАВДАННЯ — ПРАВИЛЬНО ОБРАХУВАТИ КІНЦЕВУ ЦІНУ ТА ОФОРМИТИ ПОСТ.
Твоя фіксована націнка на товар або комплект складає **+${MARGIN_UAH} ГРН**.

--- 🧠 СУВОРІ ПРАВИЛА РОЗРАХУНКУ ЦІНИ:

1. **ПООДИНОКИЙ ТОВАР** (куртка, сумка, футболка, кросівки):
   - Знаходиш ціну постачальника (дроп / опт / ціна).
   - Додаєш +${MARGIN_UAH} ГРН.
   - Приклад: Дроп 1000 грн -> Виводь: 💰 1299 ГРН

2. **КОМПЛЕКТ / КОСТЮМ / НАБІР З ОКРЕМИМИ ЦІНАМИ ЗА РЕЧІ** (наприклад: "Вітрівка - 1550 ГРН, Штани - 1050 ГРН"):
   - ЯКЩО це костюм/комплект і вказані тільки окремі ціни за кожен елемент:
     СУМУЙ ціни елементів (1550 + 1050 = 2600 ГРН) і додай НАЦІНКУ +${MARGIN_UAH} ГРН (2600 + 299 = 2899 ГРН).
   - У блоці "💰" виводь підсумкову ціну за весь комплект:
     💰 2899 ГРН (За комплект)
   - За бажанням у блоці "▪ Деталі:" можеш вказати ціни окремо з урахуванням націнки:
     ▪ Деталі: Вітрівка - 1849 ГРН, Штани - 1349 ГРН (або 2899 ГРН за весь комплект).

3. **КОМПЛЕКТ ЗІ ВКАЗАНОЮ ЦІНОЮ "КОМПЛЕКТОМ / РАЗОМ"**:
   - Якщо вказано: "Вітрівка 1000, Штани 1000, Комплектом 1800".
   - Береш ціну комплекту (1800) + ${MARGIN_UAH} ГРН = 2099 ГРН.

4. НЕ плутай артикули (наприклад, "АРТ - Р002"), розміри (S, M, L) чи коди товарів з цінами!
5. КАТЕГОРИЧНО ЗАБОРОНЕНО використовувати слова "ДРОП", "ОПТ", "ЦІНА ПОСТАЧАЛЬНИКА".

--- 📋 СУВОРИЙ ШАБЛОН ПОСТА (ЖОДНОГО MARKDOWN ** або HTML):

[БРЕНД І НАЗВА ТОВАРУ ВЕРХНІМ РЕГІСТРОМ]

▪ Матеріал: [Матеріал]
▪ Розміри: [Розміри]
▪ Деталі: [Деталі товару / Склад комплекту]

💰 [КІНЦЕВА ЦІНА З НАЦІНКУ] ГРН

📫 Для замовлення пишіть у Дірект

#одягукраїна #інстамагазин #брендовийодяг #стильнийодяг #barylux #купитиодягукраїна [3-4 хештеги за темою]

--- 🚫 ПРАВИЛА ОЧИЩЕННЯ:
- Повністю ВИДАЛИ: менеджерів, CRM, "заміри в коментарях", "фото файлом", артикули (АРТ-...), номери телефонів, телеграм-посилання.
- Видавай ТІЛЬКИ чистий текст поста без привітань та вступних слів.
`.trim();

  try {
    const res = await openai.chat.completions.create({
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: finalInstructions },
        { role: "user", content: originalText },
      ],
      temperature: 0.1,
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