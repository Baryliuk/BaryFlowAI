import { albumCache } from "../store/memory.store";
import { sendDraft } from "./draft.handler";

export const photoHandler = async (ctx: any) => {
  const photo = ctx.message.photo.pop();
  const groupId = ctx.message.media_group_id;
  const caption = ctx.message.caption;

  // 1. Якщо це поодиноке фото (не альбом)
  if (!groupId) {
    if (!caption) return ctx.reply("Бро, де опис? Без нього не можу.");
    const link = await ctx.telegram.getFileLink(photo.file_id);
    return sendDraft(ctx, [link.href], [photo.file_id], caption);
  }

  // 2. Якщо це частина альбому
  let group = albumCache.get(groupId);
  if (!group) {
    group = { photos: [], fileIds: [] };
    albumCache.set(groupId, group);
  }

  const link = await ctx.telegram.getFileLink(photo.file_id);
  group.photos.push(link.href);
  group.fileIds.push(photo.file_id);
  
  // Опис зазвичай приходить тільки з першим або останнім фото альбому
  if (caption) group.caption = caption;

  // 3. ТАЙМЕР ОЧІКУВАННЯ (Critical Fix)
  if (group.timer) clearTimeout(group.timer);
  
  group.timer = setTimeout(async () => {
    const finalGroup = albumCache.get(groupId);
    if (finalGroup) {
      if (!finalGroup.caption) {
        // Якщо альбом прийшов, а опису немає (буває, якщо опис загубився)
        await ctx.reply("🚨 Альбом отримав, але опису немає. Спробуй ще раз.");
      } else {
        console.log(`📦 Альбом зібрано: ${finalGroup.photos.length} фото.`);
        await sendDraft(ctx, finalGroup.photos, finalGroup.fileIds, finalGroup.caption);
      }
      albumCache.delete(groupId);
    }
  }, 5000); // Чекаємо 5 секунд, поки Телеграм докине всі фотки
};