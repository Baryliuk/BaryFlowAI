import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(__dirname, "../../data.db"));

// Створюємо таблицю з підтримкою кастомного промпту
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    insta_biz_id TEXT,
    insta_token TEXT,
    insta_username TEXT,
    margin REAL DEFAULT 1.2,
    style TEXT DEFAULT 'standard',
    custom_prompt TEXT
  )
`);

// На випадок якщо база вже була, додаємо колонку
try { db.exec(`ALTER TABLE user_settings ADD COLUMN custom_prompt TEXT`); } catch (e) {}

export const dbService = {
  getSettings: (userId: number) => {
    const stmt = db.prepare("SELECT * FROM user_settings WHERE user_id = ?");
    return stmt.get(userId) as any;
  },
  
  updateSettings: (userId: number, settings: any) => {
    const keys = Object.keys(settings);
    const values = Object.values(settings);
    const setClause = keys.map((key) => `${key} = ?`).join(", ");

    const user = dbService.getSettings(userId);
    if (!user) {
      const columns = ["user_id", ...keys].join(", ");
      const placeholders = ["?", ...keys.map(() => "?")].join(", ");
      const insert = db.prepare(`INSERT INTO user_settings (${columns}) VALUES (${placeholders})`);
      return insert.run(userId, ...values);
    } else {
      const update = db.prepare(`UPDATE user_settings SET ${setClause} WHERE user_id = ?`);
      return update.run(...values, userId);
    }
  },

  // ОСЬ ЦЬОГО МЕТОДУ У ТЕБЕ НЕ ВИСТАЧАЛО:
  updatePrompt: (userId: number, prompt: string) => {
    return dbService.updateSettings(userId, { custom_prompt: prompt });
  }
};