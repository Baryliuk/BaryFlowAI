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

/**
 * Очікує готовності медіа-контейнера в Meta Graph API
 */
async function waitUntilReady(
  containerId: string,
  token: string,
  maxAttempts = 20,
  intervalMs = 3000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      // Якщо Meta явно відхилила медіа (ERROR/EXPIRED) — зупиняємось негайно
      if (err instanceof Error && err.message.startsWith("Meta відхилила")) {
        throw err;
      }

      // При мережевих збоях робимо warning і продовжуємо спроби polling до ліміту
      console.warn(`⚠️ Перевірка статусу ${containerId} (спроба ${attempt}/${maxAttempts}):`, 
        axios.isAxiosError(err) ? err.message : err
      );

      if (attempt === maxAttempts) {
        throw new Error(`Таймаут очікування готовності контейнера ${containerId}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const createContainer = async (
  url: string,
  params: Record<string, unknown>,
  token: string
): Promise<string> => {
  try {
    const { data } = await axios.post<{ id: string }>(
      url,
      {
        ...params,
        access_token: token,
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    if (!data?.id) {
      throw new Error("Meta API не повернула ID контейнера.");
    }

    return data.id;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
      throw new Error(`Meta API Error: ${err.response.data.error.message}`);
    }
    throw err;
  }
};

export const postCarousel = async (
  photoUrls: string[],
  caption: string,
  user: InstagramUserConfig
): Promise<string> => {
  if (!photoUrls || photoUrls.length === 0) {
    throw new Error("Масив photoUrls не може бути порожнім.");
  }

  if (photoUrls.length > 10) {
    throw new Error("Instagram дозволяє максимум 10 фото у каруселі.");
  }

  const publishUrl = `${GRAPH_API_BASE}/${user.bizId}/media`;
  const publishFinalUrl = `${GRAPH_API_BASE}/${user.bizId}/media_publish`;

  // --- 1. ОДИНОЧНЕ ФОТО ---
  if (photoUrls.length === 1) {
    const containerId = await createContainer(
      publishUrl,
      { image_url: photoUrls[0], caption },
      user.token
    );
    await waitUntilReady(containerId, user.token);
    await axios.post(
      publishFinalUrl,
      { creation_id: containerId, access_token: user.token },
      { timeout: REQUEST_TIMEOUT_MS }
    );
    return `https://www.instagram.com/${user.username}/`;
  }

  // --- 2. КАРУСЕЛЬ ---
  console.log(`🎠 Створюємо ${photoUrls.length} контейнерів паралельно для @${user.username}...`);

  const itemIds = await Promise.all(
    photoUrls.map((url) =>
      createContainer(publishUrl, { image_url: url, is_carousel_item: true }, user.token)
    )
  );

  const carouselId = await createContainer(
    publishUrl,
    {
      media_type: "CAROUSEL",
      children: itemIds,
      caption,
    },
    user.token
  );

  await waitUntilReady(carouselId, user.token);

  await axios.post(
    publishFinalUrl,
    { creation_id: carouselId, access_token: user.token },
    { timeout: REQUEST_TIMEOUT_MS }
  );

  return `https://www.instagram.com/${user.username}/`;
};