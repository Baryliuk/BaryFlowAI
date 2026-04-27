import { Telegraf } from "telegraf";
import { CONFIG } from "./config/env";
import { photoHandler } from "./handlers/photo.handler";
import { callbackHandler } from "./handlers/cb.handler";
import { dbService } from "./services/db.service";
import { editingSession, draftStore } from "./store/memory.store";


// 1. Ініціалізація бота
if (!CONFIG.BOT_TOKEN) {
  console.error("🚨 Помилка: TELEGRAM_BOT_TOKEN не знайдено в .env.local");
  process.exit(1);
}

const bot = new Telegraf(CONFIG.BOT_TOKEN);

bot.telegram.setMyCommands([
  { command: "start", description: "Запустити бота та отримати інструкцію" },
  {
    command: "setup",
    description: "Підключити Instagram (ID, Token, Username)",
  },
  { command: "settings", description: "Показати мої поточні налаштування" },
  { command: "help", description: "Як отримати ключі Meta" },
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
  `;

  ctx.replyWithMarkdown(helpText);
});
bot.command("settings", async (ctx) => {
  const s = dbService.getSettings(ctx.from.id);

  if (!s) {
    return ctx.reply(
      "❌ Налаштування не знайдені. Використай /setup для реєстрації.",
    );
  }

  const msg = `
⚙️ *Твої налаштування:*

👤 *Instagram:* @${s.insta_username || "Не вказано"}
🆔 *Business ID:* \`${s.insta_biz_id || "Не вказано"}\`
💰 *Націнка:* ${((s.margin - 1) * 100).toFixed(0)}% (коефіцієнт ${s.margin})
✍️ *Стиль:* ${s.style}

🔑 *Токен:* ${s.insta_token ? "✅ Встановлено" : "❌ Відсутній"}
  `;

  ctx.replyWithMarkdown(msg);
});

bot.command("setup", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 4) {
    return ctx.reply("❌ Формат: /setup [BIZ_ID] [TOKEN] [USERNAME]");
  }

  const [_, bizId, token, username] = args;

  dbService.updateSettings(ctx.from.id, {
    insta_biz_id: bizId,
    insta_token: token,
    insta_username: username,
  });

  await ctx.reply("✅ Дані Instagram збережено! Тепер спробуй надіслати пост.");
});

// 3. Реєстрація хендлерів
// Обробка фото та альбомів

bot.on("text", async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  // Перевіряємо, чи юзер зараз у стані редагування
  const draftId = editingSession.get(userId);

  if (draftId) {
    const draft = draftStore.get(draftId);
    if (draft) {
      // 1. Оновлюємо текст у чернетці
      draft.caption = ctx.message.text;
      draftStore.set(draftId, draft);

      // 2. Вимикаємо режим редагування
      editingSession.delete(userId);

      // 3. Повертаємо оновлений результат з кнопками
      return ctx.reply("✅ Текст виправлено! Тепер публікуємо?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🚀 Опублікувати", callback_data: `publish_${draftId}` },
              {
                text: "✏️ Редагувати ще раз",
                callback_data: `edit_${draftId}`,
              },
            ],
            [{ text: "🗑 Видалити", callback_data: `delete_${draftId}` }],
          ],
        },
      });
    }
  }
  return next();
});
bot.command("prompt", async (ctx) => {
  const text = ctx.message.text.replace("/prompt", "").trim();
  
  if (!text) {
    return ctx.reply("✍️ Напиши інструкцію після команди. \n\nНаприклад: `/prompt Пиши максимально коротко, без емодзі, тільки розміри та ціна.`", { parse_mode: 'Markdown' });
  }

  dbService.updatePrompt(ctx.from.id, text);
  await ctx.reply("✅ Твій кастомний стиль збережено! Тепер я буду робити описи саме так.");
});
// Обробка фото та альбомів
bot.on("photo", photoHandler);

// Обробка кнопок
bot.on("callback_query", callbackHandler);

// Команда старт для перевірки
bot.command("start", (ctx) =>
  ctx.reply("BaryFlow AI готовий до роботи! Кидай альбом з описом. 🦾"),
);

// 4. Запуск бота
bot
  .launch()
  .then(() => {
    console.log("*****************************************");
    console.log("🚀 BaryFlow AI успішно запущено!");
    console.log(`👤 Власник ID: ${CONFIG.ALLOWED_ID}`);
    console.log("*****************************************");
  })
  .catch((err) => {
    console.error("🚨 Помилка при запуску бота:", err);
  });

// М'яка зупинка при вимкненні сервера
process.once("SIGINT", () => {
  console.log("🛑 Бот зупиняється (SIGINT)...");
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  console.log("🛑 Бот зупиняється (SIGTERM)...");
  bot.stop("SIGTERM");
});
