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
    console.log(`📝 ШІ рерайт для ${photos.length} фото...`);
    await ctx.reply("⏳ ШІ чаклує над постом...");

    const aiText = await getAIRewrite(rawCaption);
    const finalDescription = aiText
      ? aiText.slice(0, MAX_CAPTION - 30) // -30 для заголовку "<b>📝 ОСЬ ТВІЙ ПОСТ:</b>\n\n"
      : rawCaption.slice(0, MAX_CAPTION - 30);

    const draftId = `${Date.now()}`;
    draftStore.set(draftId, { photos, fileIds, caption: aiText ?? rawCaption });

    await ctx.replyWithPhoto(fileIds[0], {
      caption: `<b>📝 ОСЬ ТВІЙ ПОСТ:</b>\n\n${finalDescription}`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Публікувати в Інсту", callback_data: `pub_${draftId}` },
            { text: "✏️ Редагувати", callback_data: `edit_${draftId}` }
          ], 
          [{ text: "🗑 Видалити", callback_data: `del_${draftId}` }],
        ],
      },
    });
  } catch (e: any) {
    console.error("🚨 DRAFT ERROR:", e.message);
    await ctx.reply(`🚨 Помилка при створенні чернетки: ${e.message}`);
  }
};