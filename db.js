const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'data', 'app.db');

async function tableExists(db, name) {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [name]
  );
  return Boolean(row);
}

async function columnExists(db, table, column) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  return columns.some((col) => col.name === column);
}

async function getOrCreateDefaultList(db, userId) {
  const existing = await db.get(
    'SELECT id FROM lists WHERE owner_user_id = ? ORDER BY id LIMIT 1',
    [userId]
  );
  if (existing) return existing.id;

  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO lists (owner_user_id, name, created_at) VALUES (?, ?, ?)',
    [userId, 'Moje zadania', now]
  );
  return result.lastID;
}

async function ensureBaseTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS list_members (
      list_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      PRIMARY KEY (list_id, user_id),
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS list_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      inviter_user_id INTEGER NOT NULL,
      invitee_user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE (list_id, invitee_user_id),
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2,
      deadline TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_user_status (
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subtask_user_status (
      subtask_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (subtask_id, user_id),
      FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, tag_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

  `);
}

async function ensureIndexes(db) {
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)');
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)'
  );
  if (await columnExists(db, 'tasks', 'list_id')) {
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id)'
    );
  }
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)'
  );
  if (await columnExists(db, 'subtasks', 'position')) {
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_subtasks_order ON subtasks(task_id, position)'
    );
  }
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_list_members_user ON list_members(user_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_invites_invitee ON list_invites(invitee_user_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_invites_list ON list_invites(list_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_task_user_status_user ON task_user_status(user_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_task_user_status_task ON task_user_status(task_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_subtask_user_status_user ON subtask_user_status(user_id)'
  );
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_subtask_user_status_subtask ON subtask_user_status(subtask_id)'
  );
}

async function migrateSchema(db) {
  const tasksExists = await tableExists(db, 'tasks');
  if (tasksExists && !(await columnExists(db, 'tasks', 'list_id'))) {
    await db.exec('ALTER TABLE tasks ADD COLUMN list_id INTEGER');
  }

  const subtasksExists = await tableExists(db, 'subtasks');
  if (subtasksExists && !(await columnExists(db, 'subtasks', 'position'))) {
    await db.exec('ALTER TABLE subtasks ADD COLUMN position INTEGER');
    const taskRows = await db.all('SELECT DISTINCT task_id FROM subtasks');
    for (const row of taskRows) {
      const subs = await db.all(
        'SELECT id FROM subtasks WHERE task_id = ? ORDER BY created_at ASC, id ASC',
        [row.task_id]
      );
      let index = 1;
      for (const sub of subs) {
        await db.run('UPDATE subtasks SET position = ? WHERE id = ?', [
          index,
          sub.id,
        ]);
        index += 1;
      }
    }
  }

  const users = await db.all('SELECT id FROM users');
  for (const user of users) {
    await getOrCreateDefaultList(db, user.id);
  }

  if (tasksExists) {
    const orphanTasks = await db.all(
      'SELECT id, user_id FROM tasks WHERE list_id IS NULL'
    );
    for (const task of orphanTasks) {
      const listId = await getOrCreateDefaultList(db, task.user_id);
      await db.run('UPDATE tasks SET list_id = ? WHERE id = ?', [
        listId,
        task.id,
      ]);
    }
  }
}

async function initDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON;');
  await ensureBaseTables(db);
  await migrateSchema(db);
  await ensureIndexes(db);

  return db;
}

module.exports = { initDb };
