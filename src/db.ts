import { Database } from "bun:sqlite";

export type ProfileRow = { bio: string | null; avatarUrl: string | null };

export function createDatabase(path: string = "scs-profile.sqlite"): Database {
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      bio TEXT,
      avatar_url TEXT
    )
  `);
  return db;
}

export function getProfile(db: Database, userId: string): ProfileRow {
  const row = db.query("SELECT bio, avatar_url as avatarUrl FROM profiles WHERE user_id = ?").get(userId) as
    | ProfileRow
    | null;
  return row ?? { bio: null, avatarUrl: null };
}

export function upsertProfile(
  db: Database,
  userId: string,
  update: { bio?: string | null; avatarUrl?: string | null }
): ProfileRow {
  const existing = getProfile(db, userId);
  const bio = update.bio !== undefined ? update.bio : existing.bio;
  const avatarUrl = update.avatarUrl !== undefined ? update.avatarUrl : existing.avatarUrl;
  db.run(
    `INSERT INTO profiles (user_id, bio, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, avatar_url = excluded.avatar_url`,
    [userId, bio, avatarUrl]
  );
  return { bio, avatarUrl };
}
