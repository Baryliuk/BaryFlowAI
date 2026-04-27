import { uploadAllPhotos } from "../services/cloud.service";
import { postCarousel } from "../services/insta.service";
import { draftStore, editingSession } from "../store/memory.store";
import { BotAction } from "../types";
import { dbService } from "../services/db.service";

export const callbackHandler = async (ctx: any) => {
  await ctx.answerCbQuery().catch(() => {});

  const data: string = ctx.callbackQuery?.data ?? "";
  const underscoreIdx = data.indexOf("_");

  // FIX: захист від рядків без підкреслення
  if (underscoreIdx === -1) return;

  const action = data.slice(0, underscoreIdx);
  const id = data.slice(underscoreIdx + 1);

  const updateStatus = async (text: string) => {
    try {
      await ctx.editMessageCaption(text).catch(async () => {
        await ctx.editMessageText(text).catch(() => {});
      });
    } catch (err) {
      console.error("Помилка оновлення статусу:", err);
    }
  };

  // BUG FIX: у оригіналі порівнювали action === "delete" АБО action === BotAction.DELETE,
  // але BotAction.DELETE = "delete" — тобто умова дублювалась і вводила в оману.
  // Тепер порівнюємо тільки з enum-значеннями (єдине джерело правди).
  if (action === BotAction.DELETE) {
    draftStore.delete(id);
    return updateStatus("🗑 Видалено.");
  }

  const draft = draftStore.get(id);
  if (!draft) {
    return ctx.reply("🚨 Чернетка не знайдена. Надішли пост заново.");
  }

  if (action === BotAction.EDIT) {
    editingSession.set(ctx.from.id, id);
    await ctx.sendChatAction("typing");
    return ctx.reply("✍️ Надішли новий текст для цього поста. Я його запам'ятаю.");
  }

  if (action === BotAction.PUBLISH) {
    const userSettings = dbService.getSettings(ctx.from.id);

    if (!userSettings?.insta_token || !userSettings?.insta_biz_id) {
      return ctx.reply("🚨 Спочатку налаштуй акаунт через /setup");
    }

    await ctx.sendChatAction("upload_photo");
    await updateStatus("🚀 Завантажую фото...");

    try {
      const urls = await uploadAllPhotos(draft.photos);

      await ctx.sendChatAction("upload_photo");
      await updateStatus(`⏳ Фото готові. Публікую в @${userSettings.insta_username}...`);

      const link = await postCarousel(urls, draft.caption, {
        bizId:    userSettings.insta_biz_id,
        token:    userSettings.insta_token,
        username: userSettings.insta_username,
      });

      await updateStatus(`✅ Опубліковано!\n🔗 ${link}`);
      draftStore.delete(id);
    } catch (e: any) {
      const raw: string =
        e.response?.data?.error?.message ?? e.message ?? "Невідома помилка";
      console.error("🚨 PUBLISH ERROR:", raw);
      await ctx.reply(`🚨 Помилка публікації: ${raw.slice(0, 500)}`);
    }
  }
};
