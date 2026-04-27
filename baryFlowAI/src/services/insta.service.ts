import axios from "axios";

const BASE = `https://graph.facebook.com/v21.0`;

// Допоміжна функція очікування (Polling)
async function waitUntilReady(containerId: string, token: string, maxAttempts = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: "status_code", access_token: token },
    });
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error(`Meta відхилила контейнер: ${containerId}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Таймаут: Meta занадто довго обробляє медіа");
}

// Тепер функція приймає третій параметр — об'єкт налаштувань юзера
export const postCarousel = async (
  photoUrls: string[], 
  caption: string, 
  user: { bizId: string; token: string; username: string } 
): Promise<string> => {
  
  const publishUrl = `${BASE}/${user.bizId}/media`;
  const publishFinalUrl = `${BASE}/${user.bizId}/media_publish`;

  // Внутрішня функція для створення контейнерів з кастомним токеном
  const createContainer = async (params: Record<string, unknown>): Promise<string> => {
    const { data } = await axios.post(publishUrl, { 
      ...params, 
      access_token: user.token 
    });
    return data.id;
  };

  // --- ОДИНОЧНЕ ФОТО ---
  if (photoUrls.length === 1) {
    console.log(`📸 Фото для @${user.username}...`);
    const containerId = await createContainer({ image_url: photoUrls[0], caption });
    
    await waitUntilReady(containerId, user.token);
    
    await axios.post(publishFinalUrl, { 
      creation_id: containerId, 
      access_token: user.token 
    });
    return `https://www.instagram.com/${user.username}/`;
  }

  // --- КАРУСЕЛЬ ---
  console.log(`🎠 Карусель для @${user.username}: ${photoUrls.length} фото...`);
  
  const itemIds = await Promise.all(
    photoUrls.map(url => createContainer({ image_url: url, is_carousel_item: true }))
  );

  const carouselId = await createContainer({
    media_type: "CAROUSEL",
    children: itemIds, // Передаємо масив ID
    caption,
  });

  await waitUntilReady(carouselId, user.token);

  await axios.post(publishFinalUrl, { 
    creation_id: carouselId, 
    access_token: user.token 
  });
  
  console.log(`✅ Карусель опублікована в @${user.username}`);
  return `https://www.instagram.com/${user.username}/`;
};