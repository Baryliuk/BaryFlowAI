import { uploadAllPhotos } from "../services/cloud.service";
import { postCarousel } from "../services/insta.service";
import { draftStore } from "../store/memory.store";
import { BotAction } from "../types";
import { dbService } from "../services/db.service";
import { editingSession } from "../store/memory.store";

export const callbackHandler = async (ctx: any) => {
  await ctx.answerCbQuery().catch(() => {});

  const data: string = ctx.callbackQuery?.data ?? "";
  const underscoreIdx = data.indexOf("_");
  const action = data.slice(0, underscoreIdx);
  const id = data.slice(underscoreIdx + 1);

  // Функція-помічник для оновлення статусу без помилок 400
  const updateStatus = async (text: string) => {
    try {
      // Спочатку пробуємо як підпис до фото
      await ctx.editMessageCaption(text).catch(async () => {
        // Якщо не вийшло (бо це текстове повідомлення) — редагуємо як текст
        await ctx.editMessageText(text).catch(() => {});
      });
    } catch (err) {
      console.error("Помилка оновлення статусу:", err);
    }
  };

  // 1. Видалення (працює завжди)
  if (action === "delete" || action === BotAction.DELETE) {
    draftStore.delete(id);
    return updateStatus("🗑 Видалено.");
  }

  // 2. Перевіряємо чернетку
  const draft = draftStore.get(id);
  if (!draft) {
    return ctx.reply("🚨 Чернетка не знайдена. Надішли пост заново.");
  }

  // 3. Редагування
  if (action === "edit" || action === BotAction.EDIT) {
    editingSession.set(ctx.from.id, id);
    await ctx.sendChatAction("typing"); 
    return ctx.reply("✍️ Надішли новий текст для цього поста. Я його запам'ятаю.");
  }

  // 4. Публікація
  if ((action === "publish" || action === BotAction.PUBLISH) && draft) {
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
        bizId: userSettings.insta_biz_id,
        token: userSettings.insta_token,
        username: userSettings.insta_username,
      });

      await updateStatus(`✅ Опубліковано!\n🔗 ${link}`);
      draftStore.delete(id);

    } catch (e: any) {
      const raw: string = e.response?.data?.error?.message ?? e.message ?? "Невідома помилка";
      console.error("🚨 PUBLISH ERROR:", raw);
      await ctx.reply(`🚨 Помилка публікації: ${raw.slice(0, 500)}`);
    }
  }
};