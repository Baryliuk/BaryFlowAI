import { Context } from "telegraf";
import { Message, Update } from "telegraf/types";
import { albumCache } from "../store/memory.store";
import { sendDraft } from "./draft.handler";

export interface AlbumItem {
  messageId: number;
  fileId: string;
}

export interface AlbumGroup {
  items: AlbumItem[];
  caption?: string;
  timer?: NodeJS.Timeout;
}

type PhotoContext = Context<Update.MessageUpdate<Message.PhotoMessage>>;

const ALBUM_DEBOUNCE_MS = 1500;

export const photoHandler = async (ctx: PhotoContext): Promise<void> => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  // Беремо фото найвищої якості (останній елемент масиву)
  const photo = photos[photos.length - 1];
  const groupId = ctx.message.media_group_id;
  const caption = ctx.message.caption;
  const messageId = ctx.message.message_id;

  // 1. Поодиноке фото (не альбом)
  if (!groupId) {
    if (!caption) {
      await ctx.reply("🚨 Додай опис до фото.");
      return;
    }
    const link = await ctx.telegram.getFileLink(photo.file_id);
    await sendDraft(ctx as Context<Update>, [link.href], [photo.file_id], caption);
    return;
  }

  // 2. АЛЬБОМ: Зберігаємо дані СИНХРОННО без чекання мережі
  let group = albumCache.get(groupId) as AlbumGroup | undefined;
  if (!group) {
    group = { items: [] };
    albumCache.set(groupId, group as never);
  }

  group.items.push({ messageId, fileId: photo.file_id });
  if (caption) {
    group.caption = caption;
  }

  // 3. Скидаємо дебаунс-таймер
  if (group.timer) {
    clearTimeout(group.timer);
  }

  group.timer = setTimeout(async () => {
    const finalGroup = albumCache.get(groupId) as AlbumGroup | undefined;
    albumCache.delete(groupId); // Чистимо кеш негайно

    if (!finalGroup) return;

    try {
      if (!finalGroup.caption) {
        await ctx.reply("🚨 Альбом отримано, але опис відсутній. Спробуй ще раз.");
        return;
      }

      // Сортуємо за хронологією відправки
      finalGroup.items.sort((a, b) => a.messageId - b.messageId);

      // Паралельно запитуємо лінки для всіх фото одночасно
      const photoLinks = await Promise.all(
        finalGroup.items.map(async (item) => {
          const link = await ctx.telegram.getFileLink(item.fileId);
          return link.href;
        })
      );

      const fileIds = finalGroup.items.map((item) => item.fileId);

      console.log(`📦 Альбом зібрано та відсортовано: ${photoLinks.length} фото.`);
      await sendDraft(ctx as Context<Update>, photoLinks, fileIds, finalGroup.caption);
    } catch (err: unknown) {
      console.error("🚨 Помилка обробки альбому в таймері:", err);
      await ctx.reply("🚨 Не вдалося обробити фотографії альбому.").catch(() => {});
    }
  }, ALBUM_DEBOUNCE_MS);
};