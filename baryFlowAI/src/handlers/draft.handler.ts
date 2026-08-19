import { Context } from "telegraf";
import { randomUUID } from "node:crypto";
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
  formattedCaption: string 
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

    // Захист від колізій при одночасних запитах
    const draftId = randomUUID();
    
    // Зберігаємо вже оброблений ШІ-текст у store
    draftStore.set(draftId, { photos, fileIds, caption: formattedCaption });

    // Екрануємо спецсимволи для безпечного відображення в Telegram
    const safeText = escapeHtml(formattedCaption);

    const maxTextLength = MAX_CAPTION_LENGTH - HEADER_TEXT.length;
    const finalDescription =
      safeText.length > maxTextLength
        ? safeText.slice(0, maxTextLength - 3) + "..."
        : safeText;

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