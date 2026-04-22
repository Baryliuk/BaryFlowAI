import axios from "axios";
import { CONFIG } from "../config/env";

export const uploadToCloudinary = async (url: string): Promise<string> => {
  try {
    const { data } = await axios.post(
      `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY.NAME}/image/upload`,
      { file: url, upload_preset: CONFIG.CLOUDINARY.PRESET }
    );
    return data.secure_url as string;
  } catch (e: any) {
    const detail = e.response?.data?.error?.message ?? e.message;
    throw new Error(`Cloudinary upload failed: ${detail}`);
  }
};

// Паралельне завантаження всіх фото за один раз
export const uploadAllPhotos = (urls: string[]): Promise<string[]> =>
  Promise.all(urls.map(uploadToCloudinary));