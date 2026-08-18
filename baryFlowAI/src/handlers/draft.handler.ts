import { Context } from "telegraf";
import { randomUUID } from "node:crypto";
import { getAIRewrite } from "../services/ai.service";
import { draftStore } from "../store/memory.store";

const MAX_CAPTION_LENGTH = 1024;
const HEADER_TEXT = "<b>📝 ОСЬ ТВІЙ ПОСТ:</b>\n\n";

/**
 * Екранування спеціальних символів для безобідного відмалювання в HTML-режимі Telegram
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

export const sendDraft = async (
  ctx: Context,
  photos: string[],
  fileIds: string[],
  rawCaption: string
): Promise<void> => {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("🚨 Не вдалося визначити користувача.");
      return;
    }

    if (!fileIds.length || !photos.length) {
      await ctx.reply("🚨 Помилка: список фотографій порожній.");
      return;
    }

    ctx.sendChatAction("typing").catch(() => {});
    const statusMsg = await ctx.reply("⏳ Створюю пост та роблю ШІ-рерайт...");

    console.log(`📝 ШІ-рерайт для ${photos.length} фото (User: ${userId})...`);
    const aiText = await getAIRewrite(rawCaption, userId);

    // Захист від колізій при одночасних запитах (Date.now() не гарантує унікальності)
    const draftId = randomUUID();
    draftStore.set(draftId, { photos, fileIds, caption: aiText });

    // Екрануємо ШІ-текст, щоб уникнути помилок синтаксису Telegram HTML
    const safeAiText = escapeHtml(aiText);

    // Точний розрахунок обрізки з урахуванням довжини хедера
    const maxTextLength = MAX_CAPTION_LENGTH - HEADER_TEXT.length;
    const finalDescription =
      safeAiText.length > maxTextLength
        ? safeAiText.slice(0, maxTextLength - 3) + "..."
        : safeAiText;

    // Видаляємо тимчасове повідомлення "завантаження", щоб не засмічувати чат
    if (statusMsg) {
      ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }

    await ctx.replyWithPhoto(fileIds[0], {
      caption: `${HEADER_TEXT}${finalDescription}`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Публікувати в Інсту", callback_data: `publish_${draftId}` },
            { text: "✏️ Редагувати", callback_data: `edit_${draftId}` },
          ],
          [{ text: "🗑 Видалити", callback_data: `delete_${draftId}` }],
        ],
      },
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Невідома помилка";
    console.error("🚨 DRAFT ERROR:", errorMessage);
    await ctx.reply(`🚨 Помилка при створенні чернетки: ${errorMessage.slice(0, 300)}`);
  }
};