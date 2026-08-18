import { getAIRewrite } from "../services/ai.service";
import { draftStore } from "../store/memory.store";

// Telegram обмежує caption до 1024 символів
const MAX_CAPTION = 1024;

export const sendDraft = async (
  ctx: any,
  photos: string[],
  fileIds: string[],
  rawCaption: string
) => {
  try {

    const userId: number | undefined = ctx.from?.id;
    if (!userId) {
      return ctx.reply("🚨 Не вдалося визначити користувача.");
    }

    console.log(`📝 ШІ рерайт для ${photos.length} фото...`);
    await ctx.reply("⏳Post creating ...");


    const aiText = await getAIRewrite(rawCaption, userId);

    const finalDescription = aiText.slice(0, MAX_CAPTION - 30);
    const draftId = `${Date.now()}`;
    draftStore.set(draftId, { photos, fileIds, caption: aiText });


    await ctx.replyWithPhoto(fileIds[0], {
      caption: `<b>📝 ОСЬ ТВІЙ ПОСТ:</b>\n\n${finalDescription}`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Публікувати в Інсту", callback_data: `publish_${draftId}` },
            { text: "✏️ Редагувати",           callback_data: `edit_${draftId}` },
          ],
          [{ text: "🗑 Видалити", callback_data: `delete_${draftId}` }],
        ],
      },
    });
  } catch (e: any) {
    console.error("🚨 DRAFT ERROR:", e.message);
    await ctx.reply(`🚨 Помилка при створенні чернетки: ${e.message}`);
  }
};
