import axios from "axios";
import { CONFIG } from "../config/env";

const BASE = `https://graph.facebook.com/v21.0`;

// Polling замість хардкод-затримки
async function waitUntilReady(containerId: string, maxAttempts = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: "status_code", access_token: CONFIG.INSTA.TOKEN },
    });
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error(`Meta відхилила контейнер: ${containerId}`);
    await new Promise(r => setTimeout(r, 3000)); // чекаємо 3 сек між спробами
  }
  throw new Error("Таймаут: Meta занадто довго обробляє медіа");
}

// Одна функція для створення одного container-item
async function createContainer(params: Record<string, unknown>): Promise<string> {
  const { data } = await axios.post(
    `${BASE}/${CONFIG.INSTA.BIZ_ID}/media`,
    { ...params, access_token: CONFIG.INSTA.TOKEN }
  );
  return data.id;
}

export const postCarousel = async (photoUrls: string[], caption: string): Promise<string> => {
  const publishUrl = `${BASE}/${CONFIG.INSTA.BIZ_ID}/media_publish`;

  // --- ОДИНОЧНЕ ФОТО ---
  if (photoUrls.length === 1) {
    console.log("📸 Публікація одиночного фото...");
    const containerId = await createContainer({ image_url: photoUrls[0], caption });
    await waitUntilReady(containerId);
    await axios.post(publishUrl, { creation_id: containerId, access_token: CONFIG.INSTA.TOKEN });
    return `https://www.instagram.com/${CONFIG.INSTA.USERNAME}/`;
  }

  // --- КАРУСЕЛЬ: паралельно створюємо всі items ---
  console.log(`🎠 Карусель: ${photoUrls.length} фото, завантаження паралельно...`);
  const itemIds = await Promise.all(
    photoUrls.map(url => createContainer({ image_url: url, is_carousel_item: true }))
  );

  // Carousel container
  const carouselId = await createContainer({
    media_type: "CAROUSEL",
    children: itemIds,
    caption,
  });

  console.log("⏳ Чекаємо готовності каруселі від Meta...");
  await waitUntilReady(carouselId);

  await axios.post(publishUrl, { creation_id: carouselId, access_token: CONFIG.INSTA.TOKEN });
  console.log("✅ Карусель опублікована.");
  return `https://www.instagram.com/${CONFIG.INSTA.USERNAME}/`;
};