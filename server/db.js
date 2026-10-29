import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'pokolenie.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tg_id INTEGER UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  birthdate TEXT,
  bio TEXT NOT NULL DEFAULT '',
  can_help TEXT NOT NULL DEFAULT '',
  need_help TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  photo_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  bot_started INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  cal_token TEXT UNIQUE,
  notify TEXT NOT NULL DEFAULT '{}',
  quiet_from TEXT,
  quiet_to TEXT,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  current_group INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_seen TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS login_requests (
  token TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  chat_id INTEGER UNIQUE,
  chat_title TEXT,
  invite_code TEXT UNIQUE NOT NULL,
  link_code TEXT,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant','mentor','nastavnik','curator')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','left')),
  coffee INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','deadline','stream','other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  checkin_code TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  reminded_day INTEGER NOT NULL DEFAULT 0,
  reminded_hour INTEGER NOT NULL DEFAULT 0,
  feedback_sent INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS events_group_time ON events(group_id, starts_at);
CREATE TABLE IF NOT EXISTS attendance (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (event_id, user_id)
);
-- Анонимные данные: автора нет, есть только HMAC-хэш (см. anon.js)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  liked TEXT NOT NULL DEFAULT '',
  improve TEXT NOT NULL DEFAULT '',
  author_hash TEXT NOT NULL,
  created_day TEXT NOT NULL,
  UNIQUE (event_id, author_hash)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  answer TEXT,
  created_day TEXT NOT NULL,
  answered_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS questions_to ON questions(to_user);
CREATE INDEX IF NOT EXISTS questions_author ON questions(author_hash);
CREATE TABLE IF NOT EXISTS anon_blocks (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_hash TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (group_id, author_hash)
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📁',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS goal_steps (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goal_updates (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  progress INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS task_done (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  multi INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  closes_at TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  chat_message_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (poll_id, user_id, option)
);
CREATE TABLE IF NOT EXISTS coffee_rounds (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (group_id, week)
);
CREATE TABLE IF NOT EXISTS coffee_pairs (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES coffee_rounds(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  c INTEGER REFERENCES users(id) ON DELETE CASCADE,
  met INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_stats (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  tg_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, tg_id, day)
);
CREATE TABLE IF NOT EXISTS thanks (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- Баллы активности. Анонимные действия сюда не пишутся, чтобы их нельзя было связать с человеком
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (group_id, user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS activity_group_time ON activity(group_id, at);
CREATE TABLE IF NOT EXISTS badges (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (group_id, user_id, code)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER,
  text TEXT NOT NULL,
  buttons TEXT,
  send_after TEXT NOT NULL DEFAULT ${NOW},
  respect_quiet INTEGER NOT NULL DEFAULT 1,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notifications_pending ON notifications(sent_at, send_after);
CREATE TABLE IF NOT EXISTS job_marks (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT ${NOW}
);
`;
db.exec(SCHEMA);

export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Миграции ----------
// База на сервере уже существует, поэтому CREATE TABLE IF NOT EXISTS для неё ничего не меняет.
// Новую колонку в существующей таблице добавляйте вызовом ensureColumn ниже — он безопасен при повторных запусках.
// Пример: ensureColumn('events', 'online', 'INTEGER NOT NULL DEFAULT 0');
export function ensureColumn(table, column, ddl) {
  const cols = all(`PRAGMA table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export const nowIso = () => new Date().toISOString();
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const randomCode = (len = 8) => {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(len)) s += abc[b % abc.length];
  return s;
};

// Секрет для анонимных хэшей и подписи ссылок. Создаётся один раз и хранится рядом с базой.
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
export const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

// Одноразовая отметка для фоновых задач: true, если отметки ещё не было
export function markOnce(key) {
  return run('INSERT OR IGNORE INTO job_marks (key) VALUES (?)', key).changes > 0;
}

export const parseJson = (s, fallback) => {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};
