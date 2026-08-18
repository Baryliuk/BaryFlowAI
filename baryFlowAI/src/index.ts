import { Telegraf } from "telegraf";
import { CONFIG } from "./config/env";
import { photoHandler } from "./handlers/photo.handler";
import { callbackHandler } from "./handlers/cb.handler";
import { dbService } from "./services/db.service";
import { editingSession, draftStore } from "./store/memory.store";

const bot = new Telegraf(CONFIG.BOT_TOKEN);

// 1. Глобальний обробник помилок (запобігає падінню процесу)
bot.catch((err, ctx) => {
  console.error(`🚨 Критична помилка у Telegraf [Update ${ctx.update.update_id}]:`, err);
});

// 2. Middleware авторизації (Захист від чужих користувачів та витрати AI-лімітів)
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (CONFIG.ALLOWED_ID && userId !== Number(CONFIG.ALLOWED_ID)) {
    console.warn(`⚠️ Спроба доступу від незареєстрованого ID: ${userId}`);
    await ctx.reply("⛔ У вас немає доступу до цього бота.");
    return;
  }
  return next();
});

// Довідка
bot.help((ctx) => {
  const helpText = `
🦾 <b>Доступні команди BaryFlow AI:</b>

1️⃣ /start — Початок роботи та інструкція.
2️⃣ <code>/setup ID TOKEN USERNAME</code> — Прив'язка Instagram.
3️⃣ /settings — Перевірити збережені налаштування.
4️⃣ /margin — Налаштувати базовий коефіцієнт націнки.
5️⃣ /prompt — Кастомний інструктаж для ШІ.
6️⃣ /help — Виклик цього меню.

<b>Як користуватися:</b>
1. Налаштуй акаунт через /setup.
2. Перешли боту фото або альбом з описом (до 10 фото).
3. Отримай готову чернетку, перевір і тисни "Опублікувати".
`.trim();

  ctx.reply(helpText, { parse_mode: "HTML" });
});

bot.command("settings", async (ctx) => {
  const s = dbService.getSettings(ctx.from.id);

  if (!s) {
    return ctx.reply("❌ Налаштування не знайдені. Використай /setup для реєстрації.");
  }

  const marginPercent = ((s.margin - 1) * 100).toFixed(0);
  const msg = `
⚙️ <b>Твої налаштування:</b>

👤 <b>Instagram:</b> @${s.insta_username ?? "Не вказано"}
🆔 <b>Business ID:</b> <code>${s.insta_biz_id ?? "Не вказано"}</code>
💰 <b>Базова націнка:</b> +${marginPercent}% (коефіцієнт ${s.margin})
✍️ <b>Стиль:</b> ${s.style}
🔑 <b>Токен:</b> ${s.insta_token ? "✅ Встановлено" : "❌ Відсутній"}
`.trim();

  ctx.reply(msg, { parse_mode: "HTML" });
});

bot.command("setup", async (ctx) => {
  // Використовуємо ctx.payload замість slice() — це захищає від команд типу /setup@bot_name
  const parts = ctx.payload.trim().split(/\s+/);
  if (parts.length < 3 || parts[0] === "") {
    return ctx.reply("❌ Формат: /setup [BIZ_ID] [TOKEN] [USERNAME]");
  }

  const [bizId, token, username] = parts;

  dbService.updateSettings(ctx.from.id, {
    insta_biz_id: bizId,
    insta_token: token,
    insta_username: username.replace("@", ""),
  });

  await ctx.reply("✅ Дані Instagram збережено! Тепер спробуй надіслати пост.");
});

bot.command("prompt", async (ctx) => {
  const text = ctx.payload.trim();

  if (!text) {
    return ctx.reply(
      "✍️ Напиши інструкцію після команди.\n\nНаприклад: <code>/prompt Пиши короткими реченнями, без емодзі.</code>",
      { parse_mode: "HTML" }
    );
  }

  dbService.updatePrompt(ctx.from.id, text);
  await ctx.reply("✅ Твій кастомний стиль збережено!");
});

bot.command("margin", async (ctx) => {
  const text = ctx.payload.trim();
  const value = parseFloat(text);

  if (isNaN(value) || value < 1.0 || value > 5.0) {
    return ctx.reply(
      "✍️ Вкажи коефіцієнт націнки після команди.\n\n" +
        "Наприклад:\n" +
        "<code>/margin 1.3</code> — це +30%\n" +
        "<code>/margin 1.5</code> — це +50%",
      { parse_mode: "HTML" }
    );
  }

  dbService.updateSettings(ctx.from.id, { margin: value });
  const percent = ((value - 1) * 100).toFixed(0);

  await ctx.reply(`✅ Базову націнку оновлено: <b>+${percent}%</b> (коефіцієнт ${value})`, {
    parse_mode: "HTML",
  });
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
    editingSession.delete(userId);
    return next();
  }

  draft.caption = ctx.message.text;
  draftStore.set(draftId, draft);
  editingSession.delete(userId);

  return ctx.reply("✅ Текст виправлено! Тепер публікуємо?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚀 Опублікувати", callback_data: `publish_${draftId}` },
          { text: "✏️ Редагувати ще раз", callback_data: `edit_${draftId}` },
        ],
        [{ text: "🗑 Видалити", callback_data: `delete_${draftId}` }],
      ],
    },
  });
});

bot.on("photo", photoHandler);
bot.on("callback_query", callbackHandler);

// Ініціалізація бота
const startBot = async () => {
  try {
    // Асинхронне встановлення меню команд
    await bot.telegram.setMyCommands([
      { command: "start", description: "Запустити бота" },
      { command: "setup", description: "Підключити Instagram" },
      { command: "settings", description: "Мої налаштування" },
      { command: "margin", description: "Коефіцієнт націнки" },
      { command: "prompt", description: "Кастомний промпт ШІ" },
      { command: "help", description: "Інструкція та допомога" },
    ]);

    await bot.launch();

    console.log("*".repeat(41));
    console.log("🚀 BaryFlow AI успішно запущено!");
    console.log(`👤 Власник ID: ${CONFIG.ALLOWED_ID}`);
    console.log("*".repeat(41));
  } catch (err) {
    console.error("🚨 Помилка при запуску бота:", err);
    process.exit(1);
  }
};

startBot();

process.once("SIGINT", () => {
  console.log("🛑 Бот зупиняється (SIGINT)...");
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  console.log("🛑 Бот зупиняється (SIGTERM)...");
  bot.stop("SIGTERM");
});