import { albumCache } from "../store/memory.store";
import { sendDraft } from "./draft.handler";

// Типізація для нашої групи
type AlbumGroup = {
  items: Array<{ messageId: number; photoUrl: string; fileId: string }>;
  caption?: string;
  timer?: NodeJS.Timeout;
};

export const photoHandler = async (ctx: any) => {
  const photo = ctx.message.photo.at(-1);
  const groupId: string | undefined = ctx.message.media_group_id;
  const caption: string | undefined = ctx.message.caption;
  const messageId: number = ctx.message.message_id;

  // 1. Обробка поодинокого фото (не альбом)
  if (!groupId) {
    if (!caption) return ctx.reply("A description is required.");
    const link = await ctx.telegram.getFileLink(photo.file_id);
    return sendDraft(ctx, [link.href], [photo.file_id], caption);
  }

  // 2. АСИНХРОННА ДІЯ ДО КЕШУ: отримуємо лінк відразу, щоб не блокувати стейт
  const link = await ctx.telegram.getFileLink(photo.file_id);

  // 3. РОБОТА З КЕШЕМ: тепер беремо найсвіжіший стан групи
  let group = albumCache.get(groupId) as unknown as AlbumGroup | undefined;
  if (!group) {
    group = { items: [] };
    albumCache.set(groupId, group as unknown as any);
  }

  // 4. Пушимо дані поточного фото
  group.items.push({
    messageId,
    photoUrl: link.href,
    fileId: photo.file_id,
  });

  // Опис приходить тільки з одним фото з альбому, зберігаємо його
  if (caption) group.caption = caption;

  // 5. ТАЙМЕР ОЧІКУВАННЯ
  if (group.timer) clearTimeout(group.timer);

  group.timer = setTimeout(async () => {
    // Забираємо фінальні дані та чистимо пам'ять
    const finalGroup = albumCache.get(groupId) as unknown as AlbumGroup | undefined;
    albumCache.delete(groupId);

    if (!finalGroup) return;

    if (!finalGroup.caption) {
      await ctx.reply("🚨 Альбом отримав, але опису немає. Спробуй ще раз.");
    } else {
      // 🔥 КЛЮЧОВИЙ ФІКС: Сортуємо елементи за зростанням messageId
      finalGroup.items.sort((a, b) => a.messageId - b.messageId);

      // Розбиваємо відсортовані дані назад на два масиви, які чекає sendDraft
      const sortedPhotos = finalGroup.items.map((item) => item.photoUrl);
      const sortedFileIds = finalGroup.items.map((item) => item.fileId);

      console.log(`📦 Альбом зібрано та відсортовано: ${sortedPhotos.length} фото.`);
      await sendDraft(ctx, sortedPhotos, sortedFileIds, finalGroup.caption);
    }
  }, 5000);
};