import { Context } from "telegraf";
import { Message, Update } from "telegraf/types";
import { albumCache } from "../store/memory.store";
import { sendDraft } from "./draft.handler";
import { getAIRewrite } from "../services/ai.service"; 

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

  const photo = photos[photos.length - 1];
  const groupId = ctx.message.media_group_id;
  const caption = ctx.message.caption;
  const messageId = ctx.message.message_id;
  const userId = ctx.from?.id ?? 0;

  // 1. ПООДИНОКЕ ФОТО
  if (!groupId) {
    if (!caption) {
      await ctx.reply("🚨 Додай опис до фото.");
      return;
    }

    const statusMsg = await ctx.reply("🤖 Обробляю опис через ШІ та розраховую ціну...");

    try {
      const link = await ctx.telegram.getFileLink(photo.file_id);
      
      // ГЕНЕРАЦІЯ ОПИСУ ЧЕРЕЗ ШІ
      const aiCaption = await getAIRewrite(caption, userId);

      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
      await sendDraft(ctx as Context<Update>, [link.href], [photo.file_id], aiCaption);
    } catch (err) {
      console.error("🚨 Помилка обробки поодинокого фото:", err);
      await ctx.reply("❌ Помилка при обробці ШІ.").catch(() => {});
    }
    return;
  }

  // 2. АЛЬБОМ: Накопичення в кеш
  let group = albumCache.get(groupId) as AlbumGroup | undefined;
  if (!group) {
    group = { items: [] };
    albumCache.set(groupId, group as never);
  }

  group.items.push({ messageId, fileId: photo.file_id });
  if (caption) {
    group.caption = caption;
  }

  // 3. ДЕБАУНС-ТАЙМЕР
  if (group.timer) {
    clearTimeout(group.timer);
  }

  group.timer = setTimeout(async () => {
    const finalGroup = albumCache.get(groupId) as AlbumGroup | undefined;
    albumCache.delete(groupId); // Чистимо кеш

    if (!finalGroup) return;

    if (!finalGroup.caption) {
      await ctx.reply("🚨 Альбом отримано, але опис відсутній. Спробуй ще раз.");
      return;
    }

    const statusMsg = await ctx.reply("🤖 Обробляю альбом та рерачу опис...");

    try {
      finalGroup.items.sort((a, b) => a.messageId - b.messageId);

      const photoLinks = await Promise.all(
        finalGroup.items.map(async (item) => {
          const link = await ctx.telegram.getFileLink(item.fileId);
          return link.href;
        })
      );

      const fileIds = finalGroup.items.map((item) => item.fileId);

      // ГЕНЕРАЦІЯ ОПИСУ ЧЕРЕЗ ШІ ДЛЯ АЛЬБОМУ
      const aiCaption = await getAIRewrite(finalGroup.caption, userId);

      console.log(`📦 Альбом зібрано (${photoLinks.length} фото), ШІ-опис оброблено.`);

      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
      await sendDraft(ctx as Context<Update>, photoLinks, fileIds, aiCaption);
    } catch (err: unknown) {
      console.error("🚨 Помилка обробки альбому в таймері:", err);
      await ctx.reply("🚨 Не вдалося обробити фотографії альбому.").catch(() => {});
    }
  }, ALBUM_DEBOUNCE_MS);
};