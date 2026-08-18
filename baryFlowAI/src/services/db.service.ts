import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Перевірка та створення директорії для БД
const dbDir = path.join(__dirname, "../../data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, "data.db"));

// Увімкнення WAL режиму для високої продуктивності
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Схема бази даних
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id        INTEGER PRIMARY KEY,
    insta_biz_id   TEXT DEFAULT NULL,
    insta_token    TEXT DEFAULT NULL,
    insta_username TEXT DEFAULT NULL,
    margin         REAL DEFAULT 1.2,
    style          TEXT DEFAULT 'standard',
    custom_prompt  TEXT DEFAULT NULL
  );
`);

export interface UserSettings {
  user_id: number;
  insta_biz_id: string | null;
  insta_token: string | null;
  insta_username: string | null;
  margin: number;
  style: string;
  custom_prompt: string | null;
}

export type SettingsUpdate = Partial<Omit<UserSettings, "user_id">>;

const ALLOWED_FIELDS = new Set<keyof SettingsUpdate>([
  "insta_biz_id",
  "insta_token",
  "insta_username",
  "margin",
  "style",
  "custom_prompt",
]);

// Компілюємо підготовлений запит 1 раз при ініціалізації
const getSettingsStmt = db.prepare<[number], UserSettings>(
  "SELECT * FROM user_settings WHERE user_id = ?"
);

export const dbService = {
  getSettings: (userId: number): UserSettings | undefined => {
    return getSettingsStmt.get(userId);
  },

  updateSettings: (userId: number, settings: SettingsUpdate): void => {
    // Фільтруємо недозволені поля та undefined значення
    const entries = Object.entries(settings).filter(
      ([key, val]) => ALLOWED_FIELDS.has(key as keyof SettingsUpdate) && val !== undefined
    );

    if (entries.length === 0) return;

    const keys = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);

    // Атомарний UPSERT через ON CONFLICT замість двох запитів (SELECT + INSERT/UPDATE)
    const columns = ["user_id", ...keys].join(", ");
    const placeholders = ["?", ...keys.map(() => "?")].join(", ");
    const updateClause = keys.map((key) => `${key} = EXCLUDED.${key}`).join(", ");

    const sql = `
      INSERT INTO user_settings (${columns}) 
      VALUES (${placeholders})
      ON CONFLICT(user_id) DO UPDATE SET ${updateClause}
    `;

    db.prepare(sql).run(userId, ...values);
  },

  updatePrompt: (userId: number, prompt: string): void => {
    dbService.updateSettings(userId, { custom_prompt: prompt });
  },
};