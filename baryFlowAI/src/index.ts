import { Telegraf } from "telegraf";
import { CONFIG } from "./config/env";
import { photoHandler } from "./handlers/photo.handler";
import { callbackHandler } from "./handlers/cb.handler";

// 1. Ініціалізація бота
if (!CONFIG.BOT_TOKEN) {
  console.error("🚨 Помилка: TELEGRAM_BOT_TOKEN не знайдено в .env.local");
  process.exit(1);
}

const bot = new Telegraf(CONFIG.BOT_TOKEN);

// 2. Глобальний Middleware для безпеки (Priority 3 з твого списку)
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== CONFIG.ALLOWED_ID) {
    console.log(`⚠️ Спроба доступу від невідомого юзера: ${ctx.from?.id}`);
    return ctx.reply("Пасасі. 🛑");
  }
  return next();
});

// 3. Реєстрація хендлерів
// Обробка фото та альбомів
bot.on("photo", photoHandler);

// Обробка кнопок "Публікувати" та "Видалити"
// ТУТ ТІЛЬКИ ОДИН ОБРОБНИК (Priority 4)
bot.on("callback_query", callbackHandler);

// Команда старт для перевірки
bot.command("start", (ctx) => ctx.reply("BaryFlow AI готовий до роботи! Кидай альбом з описом. 🦾"));

// 4. Запуск бота
bot.launch()
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
