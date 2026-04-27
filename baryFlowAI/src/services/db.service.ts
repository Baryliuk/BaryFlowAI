import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(__dirname, "../../data.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id       INTEGER PRIMARY KEY,
    insta_biz_id  TEXT,
    insta_token   TEXT,
    insta_username TEXT,
    margin        REAL    DEFAULT 1.2,
    style         TEXT    DEFAULT 'standard',
    custom_prompt TEXT
  )
`);

// На випадок якщо база вже існувала до додавання колонки
try { db.exec(`ALTER TABLE user_settings ADD COLUMN custom_prompt TEXT`); } catch (_) {}

// Допустимі поля для оновлення — захист від SQL injection через динамічні ключі
const ALLOWED_FIELDS = new Set([
  "insta_biz_id",
  "insta_token",
  "insta_username",
  "margin",
  "style",
  "custom_prompt",
]);

export interface UserSettings {
  user_id:        number;
  insta_biz_id:   string | null;
  insta_token:    string | null;
  insta_username: string | null;
  margin:         number;
  style:          string;
  custom_prompt:  string | null;
}

// FIX: додано тип для параметра settings — раніше був `any`, що приховувало помилки
type SettingsUpdate = Partial<Omit<UserSettings, "user_id">>;

export const dbService = {
  getSettings: (userId: number): UserSettings | undefined => {
    const stmt = db.prepare("SELECT * FROM user_settings WHERE user_id = ?");
    return stmt.get(userId) as UserSettings | undefined;
  },

  updateSettings: (userId: number, settings: SettingsUpdate): void => {
    const keys = Object.keys(settings);
    const values = Object.values(settings);

    // FIX: валідація ключів — у оригіналі будь-який ключ міг потрапити в SQL
    const invalidKeys = keys.filter((k) => !ALLOWED_FIELDS.has(k));
    if (invalidKeys.length > 0) {
      throw new Error(`Недозволені поля: ${invalidKeys.join(", ")}`);
    }

    if (keys.length === 0) return;

    const setClause = keys.map((key) => `${key} = ?`).join(", ");
    const existing = dbService.getSettings(userId);

    if (!existing) {
      const columns = ["user_id", ...keys].join(", ");
      const placeholders = ["?", ...keys.map(() => "?")].join(", ");
      db.prepare(`INSERT INTO user_settings (${columns}) VALUES (${placeholders})`).run(
        userId,
        ...values
      );
    } else {
      db.prepare(`UPDATE user_settings SET ${setClause} WHERE user_id = ?`).run(
        ...values,
        userId
      );
    }
  },

  updatePrompt: (userId: number, prompt: string): void => {
    dbService.updateSettings(userId, { custom_prompt: prompt });
  },
};
