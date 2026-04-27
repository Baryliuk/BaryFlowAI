import axios from "axios";

const BASE = `https://graph.facebook.com/v21.0`;

async function waitUntilReady(
  containerId: string,
  token: string,
  maxAttempts = 20
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: "status_code,status", access_token: token },
    });

    if (data.status_code === "FINISHED") return;

    // FIX: логуємо статус при помилці для легшого дебагу
    if (data.status_code === "ERROR") {
      throw new Error(
        `Meta відхилила контейнер ${containerId}. Статус: ${data.status ?? "ERROR"}`
      );
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `Таймаут: Meta обробляє медіа понад ${(maxAttempts * 3)} секунд`
  );
}

export const postCarousel = async (
  photoUrls: string[],
  caption: string,
  user: { bizId: string; token: string; username: string }
): Promise<string> => {
  // FIX: Instagram дозволяє максимум 10 фото у каруселі
  if (photoUrls.length > 10) {
    throw new Error("Instagram дозволяє максимум 10 фото у каруселі.");
  }

  const publishUrl      = `${BASE}/${user.bizId}/media`;
  const publishFinalUrl = `${BASE}/${user.bizId}/media_publish`;

  const createContainer = async (params: Record<string, unknown>): Promise<string> => {
    const { data } = await axios.post(publishUrl, {
      ...params,
      access_token: user.token,
    });
    return data.id as string;
  };

  // --- ОДИНОЧНЕ ФОТО ---
  if (photoUrls.length === 1) {
    console.log(`📸 Публікую одне фото для @${user.username}...`);
    const containerId = await createContainer({ image_url: photoUrls[0], caption });
    await waitUntilReady(containerId, user.token);
    await axios.post(publishFinalUrl, { creation_id: containerId, access_token: user.token });
    return `https://www.instagram.com/${user.username}/`;
  }

  // --- КАРУСЕЛЬ ---
  console.log(`🎠 Карусель для @${user.username}: ${photoUrls.length} фото...`);

  // FIX: у оригіналі всі контейнери створювались паралельно через Promise.all,
  // але потім одразу без waitUntilReady для кожного окремого item.
  // Meta може відхилити carousel якщо items ще не FINISHED.
  // Тепер чекаємо готовності кожного item перед створенням carousel-контейнера.
  const itemIds: string[] = [];
  for (const url of photoUrls) {
    const itemId = await createContainer({ image_url: url, is_carousel_item: true });
    await waitUntilReady(itemId, user.token);
    itemIds.push(itemId);
  }

  const carouselId = await createContainer({
    media_type: "CAROUSEL",
    children: itemIds.join(","), // FIX: Meta очікує рядок через кому, не масив
    caption,
  });

  await waitUntilReady(carouselId, user.token);

  await axios.post(publishFinalUrl, {
    creation_id: carouselId,
    access_token: user.token,
  });

  console.log(`✅ Карусель опублікована в @${user.username}`);
  return `https://www.instagram.com/${user.username}/`;
};
