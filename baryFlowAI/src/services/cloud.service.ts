import axios from "axios";
import { CONFIG } from "../config/env";

interface CloudinaryResponse {
  secure_url: string;
}

const UPLOAD_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_UPLOADS = 3;

export const uploadToCloudinary = async (url: string): Promise<string> => {
  if (!url) {
    throw new Error("Cloudinary upload failed: URL is empty");
  }

  try {
    const { data } = await axios.post<CloudinaryResponse>(
      `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY.NAME}/image/upload`,
      {
        file: url,
        upload_preset: CONFIG.CLOUDINARY.PRESET,
      },
      {
        timeout: UPLOAD_TIMEOUT_MS,
      }
    );

    if (!data?.secure_url) {
      throw new Error("Invalid response format: missing secure_url");
    }

    return data.secure_url;
  } catch (err: unknown) {
    let detail = "Unknown error";

    if (axios.isAxiosError(err)) {
      detail = err.response?.data?.error?.message ?? err.message;
    } else if (err instanceof Error) {
      detail = err.message;
    }

    throw new Error(`Cloudinary upload failed: ${detail}`);
  }
};

/**
 * Завантажує фото з обмеженням паралельних запитів (Concurrency Control)
 */
export const uploadAllPhotos = async (urls: string[]): Promise<string[]> => {
  if (!urls.length) return [];

  const results: string[] = [];

  // Батчінг: завантажуємо порціями, щоб уникнути RATE LIMIT та забиття сокетів
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT_UPLOADS) {
    const chunk = urls.slice(i, i + MAX_CONCURRENT_UPLOADS);
    const chunkResults = await Promise.all(chunk.map(uploadToCloudinary));
    results.push(...chunkResults);
  }

  return results;
};