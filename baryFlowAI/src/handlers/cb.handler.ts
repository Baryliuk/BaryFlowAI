import { Context } from "telegraf";
import { uploadAllPhotos } from "../services/cloud.service";
import { postCarousel } from "../services/insta.service";
import { draftStore, editingSession } from "../store/memory.store";
import { BotAction } from "../types";
import { dbService } from "../services/db.service";

interface ApiErrorResponse {
  response?: {
    data?: {
      error?: {
        message?: string;
      };
    };
  };
}

const updateStatusMessage = async (ctx: Context, text: string): Promise<void> => {
  try {
    await ctx.editMessageCaption(text);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("message is not modified")) {
      return;
    }
    try {
      await ctx.editMessageText(text);
    } catch {
      // Ігноруємо, якщо тип повідомлення не підтримує редагування тексту
    }
  }
};

export const callbackHandler = async (ctx: Context): Promise<void> => {
  // Файримо answerCbQuery одразу, не чекаючи виконання handler'а
  ctx.answerCbQuery().catch(() => {});

  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;

  const data = ctx.callbackQuery.data;
  const underscoreIdx = data.indexOf("_");
  if (underscoreIdx === -1) return;

  const action = data.slice(0, underscoreIdx);
  const id = data.slice(underscoreIdx + 1);
  const userId = ctx.from?.id;

  if (!userId) return;

  if (action === BotAction.DELETE) {
    draftStore.delete(id);
    await updateStatusMessage(ctx, "🗑 Видалено.");
    return;
  }

  const draft = draftStore.get(id);
  if (!draft) {
    await ctx.reply("🚨 Чернетка не знайдена. Надішли пост заново.");
    return;
  }

  if (action === BotAction.EDIT) {
    editingSession.set(userId, id);
    // Fire-and-forget: не блокуємо Event Loop чеканням чат-екшну
    ctx.sendChatAction("typing").catch(() => {});
    await ctx.reply("✍️ Надішли новий текст для цього поста. Я його запам'ятаю.");
    return;
  }

  if (action === BotAction.PUBLISH) {
    const userSettings = dbService.getSettings(userId);

    if (!userSettings?.insta_token || !userSettings?.insta_biz_id) {
      await ctx.reply("🚨 Спочатку налаштуй акаунт через /setup");
      return;
    }

    ctx.sendChatAction("upload_photo").catch(() => {});
    await updateStatusMessage(ctx, "🚀 Завантажую фото...");

    try {
      const urls = await uploadAllPhotos(draft.photos);

      ctx.sendChatAction("upload_photo").catch(() => {});
      await updateStatusMessage(ctx, "⏳ Фото готові. Публікую в instagram...");

      const link = await postCarousel(urls, draft.caption, {
        bizId: userSettings.insta_biz_id,
        token: userSettings.insta_token,
        username: userSettings.insta_username ?? "",
      });

      await updateStatusMessage(ctx, `✅ Опубліковано!\n🔗 ${link}`);
      draftStore.delete(id);
    } catch (e: unknown) {
      let errorMessage = "Невідома помилка";

      if (e instanceof Error) {
        errorMessage = e.message;
      }
      
      const apiErr = e as ApiErrorResponse;
      if (apiErr.response?.data?.error?.message) {
        errorMessage = apiErr.response.data.error.message;
      }

      console.error("🚨 PUBLISH ERROR:", errorMessage);
      await ctx.reply(`🚨 Помилка публікації: ${errorMessage.slice(0, 500)}`);
    }
  }
};