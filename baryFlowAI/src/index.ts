import { Telegraf } from "telegraf";
import { CONFIG } from "./config/env";
import { photoHandler } from "./handlers/photo.handler";
import { callbackHandler } from "./handlers/cb.handler";
import { dbService } from "./services/db.service";
import { editingSession, draftStore } from "./store/memory.store";

const bot = new Telegraf(CONFIG.BOT_TOKEN);

bot.telegram.setMyCommands([
  { command: "start",    description: "Запустити бота та отримати інструкцію" },
  { command: "setup",    description: "Підключити Instagram (ID, Token, Username)" },
  { command: "settings", description: "Показати мої поточні налаштування" },
  { command: "help",     description: "Як отримати ключі Meta" },
  { command: "prompt",   description: "Замінити стандартний промпт для генерації описів" },
]);


bot.help((ctx) => {
  const helpText = `
🦾 *Доступні команди BaryFlow AI:*

1️⃣ /start — Початок роботи та коротка інструкція.
2️⃣ \`/setup ID TOKEN USERNAME\` — Прив'язка твого Instagram акаунта.
3️⃣ /settings — Перевірити, які дані зараз збережені.
4️⃣ /help — Виклик цього меню.
5️⃣ /prompt — Замінити стандартний промпт для генерації описів (для просунутих користувачів).

*Як користуватися:*
1. Налаштуй акаунт через /setup.
2. Просто перешліть боту фото або альбом з описом (до 10 фото).
3. Отримай готову чернетку, перевір і тисни "Опублікувати".

⚠️ *Важливо:* Опис має містити ціну, щоб бот міг зробити націнку.
  `.trim();

  ctx.replyWithMarkdown(helpText);
});

bot.command("settings", async (ctx) => {
  const s = dbService.getSettings(ctx.from.id);

  if (!s) {
    return ctx.reply("❌ Налаштування не знайдені. Використай /setup для реєстрації.");
  }

  const msg = `
⚙️ *Твої налаштування:*

👤 *Instagram:* @${s.insta_username ?? "Не вказано"}
🆔 *Business ID:* \`${s.insta_biz_id ?? "Не вказано"}\`
💰 *Націнка:* ${((s.margin - 1) * 100).toFixed(0)}% (коефіцієнт ${s.margin})
✍️ *Стиль:* ${s.style}
💰 *Базова націнка:* **${(s.margin * 100 - 100).toFixed(0)}%** (коефіцієнт ${s.margin})

🔑 *Токен:* ${s.insta_token ? "✅ Встановлено" : "❌ Відсутній"}
  `.trim();

  ctx.replyWithMarkdown(msg);
});

bot.command("setup", async (ctx) => {
  // FIX: split(" ") ламається якщо між аргументами кілька пробілів.
  // Використовуємо slice(7).trim().split(/\s+/) для надійності.
  const parts = ctx.message.text.slice(6).trim().split(/\s+/);
  if (parts.length < 3 || parts[0] === "") {
    return ctx.reply("❌ Формат: /setup [BIZ_ID] [TOKEN] [USERNAME]");
  }

  const [bizId, token, username] = parts;

  dbService.updateSettings(ctx.from.id, {
    insta_biz_id:   bizId,
    insta_token:    token,
    insta_username: username,
  });

  await ctx.reply("✅ Дані Instagram збережено! Тепер спробуй надіслати пост.");
});

bot.command("prompt", async (ctx) => {
  const text = ctx.message.text.replace("/prompt", "").trim();

  if (!text) {
    return ctx.reply(
      "✍️ Напиши інструкцію після команди.\n\nНаприклад: `/prompt Пиши максимально коротко, без емодзі, тільки розміри та ціна.`",
      { parse_mode: "Markdown" }
    );
  }

  dbService.updatePrompt(ctx.from.id, text);
  await ctx.reply("✅ Твій кастомний стиль збережено! Тепер я буду робити описи саме так.");
});

bot.command("margin", async (ctx) => {
  const text = ctx.message.text.replace("/margin", "").trim();
  const value = parseFloat(text);

  if (isNaN(value) || value < 1.0 || value > 5.0) {
    return ctx.reply(
      "✍️ Вкажи коефіцієнт націнки після команди.\n\n" +
      "Наприклад:\n" +
      "`/margin 1.3` — це +30%\n" +
      "`/margin 1.5` — це +50%\n\n" +
      "*Примітка:* Ця націнка застосується до товарів дорожче 1000 грн. Для дешевших товарів діють автоматичні правила (50% та 35%).",
      { parse_mode: "Markdown" }
    );
  }

  dbService.updateSettings(ctx.from.id, { margin: value });
  
  await ctx.reply(`✅ Базову націнку оновлено: **${(value * 100 - 100).toFixed(0)}%** (коефіцієнт ${value})`, { parse_mode: "Markdown" });
});

bot.command("start", (ctx) =>
  ctx.reply("BaryFlow AI готовий до роботи! Кидай альбом з описом. 🦾")
);

// Обробка редагування тексту чернетки
bot.on("text", async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const draftId = editingSession.get(userId);
  if (!draftId) return next();

  const draft = draftStore.get(draftId);
  if (!draft) {
    editingSession.delete(userId); // FIX: прибираємо "застряглу" сесію
    return next();
  }

  draft.caption = ctx.message.text;
  draftStore.set(draftId, draft);
  editingSession.delete(userId);

  return ctx.reply("✅ Текст виправлено! Тепер публікуємо?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚀 Опублікувати",      callback_data: `publish_${draftId}` },
          { text: "✏️ Редагувати ще раз", callback_data: `edit_${draftId}` },
        ],
        [{ text: "🗑 Видалити", callback_data: `delete_${draftId}` }],
      ],
    },
  });
});

bot.on("photo", photoHandler);
bot.on("callback_query", callbackHandler);

bot
  .launch()
  .then(() => {
    console.log("*".repeat(41));
    console.log("🚀 BaryFlow AI успішно запущено!");
    console.log(`👤 Власник ID: ${CONFIG.ALLOWED_ID}`);
    console.log("*".repeat(41));
  })
  .catch((err) => {
    console.error("🚨 Помилка при запуску бота:", err);
    process.exit(1);
  });

process.once("SIGINT",  () => { console.log("🛑 Бот зупиняється (SIGINT)...");  bot.stop("SIGINT");  });
process.once("SIGTERM", () => { console.log("🛑 Бот зупиняється (SIGTERM)..."); bot.stop("SIGTERM"); });
