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
  // ВИДАЛЕНО: глобальні INSTA credentials — тепер всі дані беруться з БД (db.service)
  // Залишати їх тут небезпечно і вводить в оману (дві різні точки правди).
};
