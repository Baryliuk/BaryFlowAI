import axios from "axios";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 15_000;

export interface InstagramUserConfig {
  bizId: string;
  token: string;
  username: string;
}

interface ContainerStatusResponse {
  status_code: "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED";
  status?: string;
  id: string;
}

interface ContainerCreateResponse {
  id: string;
}

/**
 * Очікує готовності медіа-контейнера в Meta Graph API
 */
async function waitUntilReady(
  containerId: string,
  token: string,
  maxAttempts = 20,
  intervalMs = 3000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data } = await axios.get<ContainerStatusResponse>(
        `${GRAPH_API_BASE}/${containerId}`,
        {
          params: { fields: "status_code,status", access_token: token },
          timeout: REQUEST_TIMEOUT_MS,
        }
      );

      if (data.status_code === "FINISHED") {
        return;
      }

      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
        throw new Error(
          `Meta відхилила контейнер ${containerId}. Статус: ${data.status ?? data.status_code}`
        );
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        throw new Error(`Meta API Error (${containerId}): ${err.response.data.error.message}`);
      }
      if (err instanceof Error && err.message.startsWith("Meta відхилила")) {
        throw err;
      }
      // При мережевому мигтінні продовжуємо спроби polling
      console.warn(`⚠️ Помилка перевірки статусу (спроба ${attempt + 1}):`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Таймаут: Meta обробляє медіа ${containerId} понад ${(maxAttempts * intervalMs) / 1000} секунд`
  );
}

export const postCarousel = async (
  photoUrls: string[],
  caption: string,
  user: InstagramUserConfig
): Promise<string> => {
  if (!photoUrls.length) {
    throw new Error("Масив photoUrls порожній.");
  }

  if (photoUrls.length > 10) {
    throw new Error("Instagram дозволяє максимум 10 фото у каруселі.");
  }

  const publishUrl = `${GRAPH_API_BASE}/${user.bizId}/media`;
  const publishFinalUrl = `${GRAPH_API_BASE}/${user.bizId}/media_publish`;

  const createContainer = async (payload: Record<string, unknown>): Promise<string> => {
    try {
      const { data } = await axios.post<ContainerCreateResponse>(
        publishUrl,
        {
          ...payload,
          access_token: user.token,
        },
        { timeout: REQUEST_TIMEOUT_MS }
      );

      if (!data?.id) {
        throw new Error("Meta не повернула ID контейнера.");
      }

      return data.id;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        throw new Error(`Meta Container Creation Failed: ${err.response.data.error.message}`);
      }
      throw err;
    }
  };

  // --- 1. ОДИНОЧНЕ ФОТО ---
  if (photoUrls.length === 1) {
    console.log(`📸 Публікую поодиноке фото для @${user.username}...`);
    const containerId = await createContainer({ image_url: photoUrls[0], caption });
    await waitUntilReady(containerId, user.token);

    await axios.post(
      publishFinalUrl,
      { creation_id: containerId, access_token: user.token },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    return `https://www.instagram.com/${user.username}/`;
  }

  // --- 2. КАРУСЕЛЬ (ПАРАЛЕЛЬНА ОБРОБКА) ---
  console.log(`🎠 Карусель для @${user.username}: ${photoUrls.length} фото...`);

  // Оптимізація: Створюємо ВСІ дочірні контейнери ПАРАЛЕЛЬНО
  const itemIds = await Promise.all(
    photoUrls.map((url) =>
      createContainer({
        image_url: url,
        is_carousel_item: true,
      })
    )
  );

  // Оптимізація: Чекаємо готовності ВСІХ дочірніх контейнерів ПАРАЛЕЛЬНО
  await Promise.all(itemIds.map((itemId) => waitUntilReady(itemId, user.token)));

  // Створюємо батьківський контейнер каруселі
  const carouselId = await createContainer({
    media_type: "CAROUSEL",
    children: itemIds, // Graph API v21.0 приймає масив рядків
    caption,
  });

  // Чекаємо готовності самого карусельного контейнера
  await waitUntilReady(carouselId, user.token);

  // Фінальна публікація
  await axios.post(
    publishFinalUrl,
    { creation_id: carouselId, access_token: user.token },
    { timeout: REQUEST_TIMEOUT_MS }
  );

  console.log(`✅ Карусель успішно опубліковано в @${user.username}`);
  return `https://www.instagram.com/${user.username}/`;
};