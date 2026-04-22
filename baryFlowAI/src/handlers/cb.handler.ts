import { uploadAllPhotos } from "../services/cloud.service";
import { postCarousel } from "../services/insta.service";
import { draftStore } from "../store/memory.store";
import { BotAction } from "../types";

export const callbackHandler = async (ctx: any) => {
  await ctx.answerCbQuery().catch(() => {});

  const data: string = ctx.callbackQuery?.data ?? "";
  const underscoreIdx = data.indexOf("_");
  const action = data.slice(0, underscoreIdx);
  const id = data.slice(underscoreIdx + 1); // безпечніше ніж split("_") — id може містити "_"

  const draft = draftStore.get(id);

  if (action === BotAction.DELETE) {
    draftStore.delete(id);
    return ctx.editMessageCaption("🗑 Видалено.");
  }

  if (action === BotAction.PUBLISH) {
    if (!draft) {
      return ctx.reply("🚨 Чернетка не знайдена — можливо, бот перезапускався. Надішли пост заново.");
    }

    await ctx.editMessageCaption("🚀 Завантажую фото паралельно...");

    try {
      const urls = await uploadAllPhotos(draft.photos);
      await ctx.editMessageCaption(`⏳ Фото на Cloudinary (${urls.length}шт). Публікую в Instagram...`);
      const link = await postCarousel(urls, draft.caption);
      await ctx.editMessageCaption(`✅ Опубліковано!\n🔗 ${link}`);
    } catch (e: any) {
      const raw: string = e.response?.data?.error?.message ?? e.message ?? "Невідома помилка";
      // Telegram обмежує підпис до 1024 символів
      const msg = raw.length > 900 ? raw.slice(0, 900) + "…" : raw;
      console.error("🚨 PUBLISH ERROR:", raw);
      await ctx.reply(`🚨 Помилка публікації:\n${msg}`);
    } finally {
      draftStore.delete(id);
    }
  }
};