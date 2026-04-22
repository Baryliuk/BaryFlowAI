import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`❌ Відсутня змінна оточення: ${key}`);
  return val;
}

export const CONFIG = {
  BOT_TOKEN:  required("TELEGRAM_BOT_TOKEN"),
  ALLOWED_ID: Number(required("ALLOWED_USER_ID")),
  NVIDIA_KEY: required("NVIDIA_API_KEY"),
  CLOUDINARY: {
    NAME:   required("CLOUDINARY_CLOUD_NAME"),
    PRESET: required("CLOUDINARY_UPLOAD_PRESET"),
  },
  INSTA: {
    BIZ_ID:   required("INSTAGRAM_BUSINESS_ID"),
    TOKEN:    required("INSTAGRAM_ACCESS_TOKEN"),
    USERNAME: process.env.INSTAGRAM_USERNAME || "barylux.ua", // для посилання у відповіді
  },
};