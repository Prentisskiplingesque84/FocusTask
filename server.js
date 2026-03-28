const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

let db;

function authRequired(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
}

function normalizeTags(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  const cleaned = list
    .map((tag) => String(tag).trim())
    .filter((tag) => tag.length > 0);
  return Array.from(new Set(cleaned));
}

function clampPriority(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 2;
  if (parsed < 1) return 1;
  if (parsed > 3) return 3;
  return parsed;
}

function priorityLabel(priority) {
  if (priority === 3) return 'Wysoki';
  if (priority === 1) return 'Niski';
  return 'Sredni';
}

function canEdit(role) {
  return role === 'owner' || role === 'editor';
}

function parseListId(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function getDefaultListId(userId) {
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

async function getListAccess(listId, userId) {
  const row = await db.get(
    `
    SELECT
      l.id,
      l.name,
      l.owner_user_id,
      u.username AS owner_username,
      CASE
        WHEN l.owner_user_id = ? THEN 'owner'
        ELSE lm.role
      END AS role
    FROM lists l
    LEFT JOIN list_members lm ON l.id = lm.list_id AND lm.user_id = ?
    LEFT JOIN users u ON l.owner_user_id = u.id
    WHERE l.id = ? AND (l.owner_user_id = ? OR lm.user_id = ?)
  `,
    [userId, userId, listId, userId, userId]
  );
  return row || null;
}

async function getUserLists(userId) {
  const rows = await db.all(
    `
    SELECT
      l.id,
      l.name,
      l.owner_user_id,
      u.username AS owner_username,
      CASE
        WHEN l.owner_user_id = ? THEN 'owner'
        ELSE lm.role
      END AS role
    FROM lists l
    LEFT JOIN list_members lm ON l.id = lm.list_id AND lm.user_id = ?
    LEFT JOIN users u ON l.owner_user_id = u.id
    WHERE l.owner_user_id = ? OR lm.user_id = ?
    ORDER BY (l.owner_user_id = ?) DESC, l.name ASC
  `,
    [userId, userId, userId, userId, userId]
  );
  return rows;
}

async function getTasksForList(listId, userId, role) {
  const rows = await db.all(
    `
    SELECT
      t.id,
      t.list_id,
      t.user_id,
      t.title,
      t.description,
      t.priority,
      t.deadline,
      t.completed,
      t.created_at,
      t.updated_at,
      tags.name AS tag_name
    FROM tasks t
    LEFT JOIN task_tags tt ON t.id = tt.task_id
    LEFT JOIN tags ON tt.tag_id = tags.id
    WHERE t.list_id = ?
    ORDER BY
      t.completed ASC,
      t.deadline IS NULL ASC,
      t.deadline ASC,
      t.created_at DESC
  `,
    [listId]
  );

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id,
        listId: row.list_id,
        userId: row.user_id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        deadline: row.deadline,
        completed: Boolean(row.completed),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tags: [],
        subtasks: [],
      });
    }
    if (row.tag_name) {
      byId.get(row.id).tags.push(row.tag_name);
    }
  }

  const taskIds = Array.from(byId.keys());
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(', ');
    const subRows = await db.all(
      `
      SELECT id, task_id, title, completed, position, created_at
      FROM subtasks
      WHERE task_id IN (${placeholders})
      ORDER BY position ASC, created_at ASC, id ASC
    `,
      taskIds
    );

    for (const sub of subRows) {
      const task = byId.get(sub.task_id);
      if (task) {
        task.subtasks.push({
          id: sub.id,
          taskId: sub.task_id,
          title: sub.title,
          completed: Boolean(sub.completed),
          position: sub.position,
          createdAt: sub.created_at,
        });
      }
    }
  }

  if (role === 'viewer' && userId && taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(', ');
    const statusRows = await db.all(
      `
      SELECT task_id, completed
      FROM task_user_status
      WHERE user_id = ? AND task_id IN (${placeholders})
    `,
      [userId, ...taskIds]
    );
    const statusMap = new Map();
    statusRows.forEach((row) => {
      statusMap.set(row.task_id, Boolean(row.completed));
    });
    for (const task of byId.values()) {
      if (statusMap.has(task.id)) {
        task.completed = statusMap.get(task.id);
      }
    }
  }

  if (role === 'viewer' && userId && taskIds.length > 0) {
    const subtaskIds = [];
    for (const task of byId.values()) {
      task.subtasks.forEach((sub) => subtaskIds.push(sub.id));
    }
    if (subtaskIds.length > 0) {
      const placeholders = subtaskIds.map(() => '?').join(', ');
      const statusRows = await db.all(
        `
        SELECT subtask_id, completed
        FROM subtask_user_status
        WHERE user_id = ? AND subtask_id IN (${placeholders})
      `,
        [userId, ...subtaskIds]
      );
      const statusMap = new Map();
      statusRows.forEach((row) => {
        statusMap.set(row.subtask_id, Boolean(row.completed));
      });
      for (const task of byId.values()) {
        task.subtasks.forEach((sub) => {
          if (statusMap.has(sub.id)) {
            sub.completed = statusMap.get(sub.id);
          }
        });
      }
    }
  }

  return Array.from(byId.values());
}

async function ensureTags(userId, tags) {
  const ids = [];
  for (const tag of tags) {
    const existing = await db.get(
      'SELECT id FROM tags WHERE user_id = ? AND name = ?',
      [userId, tag]
    );
    if (existing) {
      ids.push(existing.id);
    } else {
      const result = await db.run(
        'INSERT INTO tags (user_id, name) VALUES (?, ?)',
        [userId, tag]
      );
      ids.push(result.lastID);
    }
  }
  return ids;
}

async function getNextSubtaskPosition(taskId) {
  const row = await db.get(
    'SELECT COALESCE(MAX(position), 0) AS max_pos FROM subtasks WHERE task_id = ?',
    [taskId]
  );
  return (row?.max_pos || 0) + 1;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function resolvePdfFont() {
  const candidates = [];
  if (process.env.PDF_FONT_PATH) {
    candidates.push(process.env.PDF_FONT_PATH);
  }
  candidates.push(path.join(__dirname, 'public', 'fonts', 'NotoSans-Regular.ttf'));
  candidates.push(path.join(__dirname, 'public', 'fonts', 'DejaVuSans.ttf'));

  if (process.platform === 'win32') {
    candidates.push('C:\\\\Windows\\\\Fonts\\\\arial.ttf');
    candidates.push('C:\\\\Windows\\\\Fonts\\\\segoeui.ttf');
    candidates.push('C:\\\\Windows\\\\Fonts\\\\calibri.ttf');
  } else if (process.platform === 'darwin') {
    candidates.push('/System/Library/Fonts/Supplemental/Arial Unicode.ttf');
    candidates.push('/System/Library/Fonts/Supplemental/Arial.ttf');
    candidates.push('/System/Library/Fonts/Supplemental/Helvetica.ttf');
  } else {
    candidates.push('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    candidates.push('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf');
    candidates.push('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf');
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (String(username).length < 3 || String(password).length < 6) {
    return res
      .status(400)
      .json({ error: 'Username min 3 chars, password min 6 chars' });
  }

  const existing = await db.get('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    [username, passwordHash, now]
  );

  await getDefaultListId(result.lastID);

  req.session.userId = result.lastID;
  req.session.username = username;

  return res.json({ id: result.lastID, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await db.get('SELECT * FROM users WHERE username = ?', [
    username,
  ]);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await getDefaultListId(user.id);

  req.session.userId = user.id;
  req.session.username = user.username;

  return res.json({ id: user.id, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(200).json({ user: null });
  }
  return res.json({
    user: { id: req.session.userId, username: req.session.username },
  });
});

app.get('/api/lists', authRequired, async (req, res) => {
  const lists = await getUserLists(req.session.userId);
  return res.json({ lists });
});

app.post('/api/lists', authRequired, async (req, res) => {
  const { name } = req.body || {};
  if (!name || String(name).trim().length === 0) {
    return res.status(400).json({ error: 'List name required' });
  }

  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO lists (owner_user_id, name, created_at) VALUES (?, ?, ?)',
    [req.session.userId, String(name).trim(), now]
  );

  return res.status(201).json({ id: result.lastID });
});

app.get('/api/lists/:id/members', authRequired, async (req, res) => {
  const listId = parseListId(req.params.id);
  if (!listId) {
    return res.status(400).json({ error: 'Invalid list id' });
  }

  const access = await getListAccess(listId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }

  const members = await db.all(
    `
    SELECT u.id, u.username, lm.role
    FROM list_members lm
    JOIN users u ON u.id = lm.user_id
    WHERE lm.list_id = ?
    ORDER BY u.username ASC
  `,
    [listId]
  );

  const owner = await db.get('SELECT id, username FROM users WHERE id = ?', [
    access.owner_user_id,
  ]);

  const uniqueMembers = [
    { id: owner.id, username: owner.username, role: 'owner' },
    ...members.filter((member) => member.id !== owner.id),
  ];

  return res.json({ members: uniqueMembers });
});

async function createInvite(listId, ownerId, username, role) {
  const access = await getListAccess(listId, ownerId);
  if (!access) {
    return { status: 404, error: 'List not found' };
  }
  if (access.role !== 'owner') {
    return { status: 403, error: 'Only owner can invite users' };
  }

  if (!username || String(username).trim().length === 0) {
    return { status: 400, error: 'Username required' };
  }

  const targetUser = await db.get('SELECT id FROM users WHERE username = ?', [
    String(username).trim(),
  ]);
  if (!targetUser) {
    return { status: 404, error: 'User not found' };
  }
  if (targetUser.id === access.owner_user_id) {
    return { status: 400, error: 'Owner already has access' };
  }

  const membership = await db.get(
    'SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?',
    [listId, targetUser.id]
  );
  if (membership) {
    return { status: 400, error: 'User already has access' };
  }

  const cleanRole = role === 'editor' ? 'editor' : 'viewer';
  const now = new Date().toISOString();
  const existing = await db.get(
    'SELECT id FROM list_invites WHERE list_id = ? AND invitee_user_id = ?',
    [listId, targetUser.id]
  );

  if (existing) {
    await db.run(
      `
      UPDATE list_invites
      SET inviter_user_id = ?, role = ?, status = 'pending', created_at = ?
      WHERE id = ?
    `,
      [ownerId, cleanRole, now, existing.id]
    );
  } else {
    await db.run(
      `
      INSERT INTO list_invites (list_id, inviter_user_id, invitee_user_id, role, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `,
      [listId, ownerId, targetUser.id, cleanRole, now]
    );
  }

  return { status: 200, data: { ok: true } };
}

app.post('/api/lists/:id/invites', authRequired, async (req, res) => {
  const listId = parseListId(req.params.id);
  if (!listId) {
    return res.status(400).json({ error: 'Invalid list id' });
  }

  const { username, role } = req.body || {};
  const result = await createInvite(listId, req.session.userId, username, role);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.data);
});

app.post('/api/lists/:id/share', authRequired, async (req, res) => {
  const listId = parseListId(req.params.id);
  if (!listId) {
    return res.status(400).json({ error: 'Invalid list id' });
  }

  const { username, role } = req.body || {};
  const result = await createInvite(listId, req.session.userId, username, role);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.data);
});

app.delete('/api/lists/:id/members/:userId', authRequired, async (req, res) => {
  const listId = parseListId(req.params.id);
  const memberId = parseListId(req.params.userId);
  if (!listId || !memberId) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const access = await getListAccess(listId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (access.role !== 'owner') {
    return res.status(403).json({ error: 'Only owner can remove members' });
  }
  if (memberId === access.owner_user_id) {
    return res.status(400).json({ error: 'Cannot remove owner' });
  }

  await db.run('DELETE FROM list_members WHERE list_id = ? AND user_id = ?', [
    listId,
    memberId,
  ]);
  return res.json({ ok: true });
});

app.get('/api/invites', authRequired, async (req, res) => {
  const invites = await db.all(
    `
    SELECT
      li.id,
      li.role,
      li.created_at,
      l.id AS list_id,
      l.name AS list_name,
      owner.username AS owner_username,
      inviter.username AS inviter_username
    FROM list_invites li
    JOIN lists l ON l.id = li.list_id
    JOIN users owner ON owner.id = l.owner_user_id
    JOIN users inviter ON inviter.id = li.inviter_user_id
    WHERE li.invitee_user_id = ? AND li.status = 'pending'
    ORDER BY li.created_at DESC
  `,
    [req.session.userId]
  );
  return res.json({ invites });
});

app.post('/api/invites/:id/accept', authRequired, async (req, res) => {
  const inviteId = parseListId(req.params.id);
  if (!inviteId) {
    return res.status(400).json({ error: 'Invalid invite id' });
  }

  const invite = await db.get(
    `
    SELECT li.*, l.owner_user_id
    FROM list_invites li
    JOIN lists l ON l.id = li.list_id
    WHERE li.id = ? AND li.invitee_user_id = ? AND li.status = 'pending'
  `,
    [inviteId, req.session.userId]
  );
  if (!invite) {
    return res.status(404).json({ error: 'Invite not found' });
  }

  await db.exec('BEGIN');
  try {
    await db.run(
      `
      INSERT INTO list_members (list_id, user_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT(list_id, user_id) DO UPDATE SET role = excluded.role
    `,
      [invite.list_id, invite.invitee_user_id, invite.role]
    );
    await db.run('UPDATE list_invites SET status = ? WHERE id = ?', [
      'accepted',
      inviteId,
    ]);
    await db.exec('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

app.post('/api/invites/:id/decline', authRequired, async (req, res) => {
  const inviteId = parseListId(req.params.id);
  if (!inviteId) {
    return res.status(400).json({ error: 'Invalid invite id' });
  }

  const invite = await db.get(
    `
    SELECT id
    FROM list_invites
    WHERE id = ? AND invitee_user_id = ? AND status = 'pending'
  `,
    [inviteId, req.session.userId]
  );
  if (!invite) {
    return res.status(404).json({ error: 'Invite not found' });
  }

  await db.run('UPDATE list_invites SET status = ? WHERE id = ?', [
    'declined',
    inviteId,
  ]);
  return res.json({ ok: true });
});

app.get('/api/tasks', authRequired, async (req, res) => {
  const listId = parseListId(req.query.listId) ||
    (await getDefaultListId(req.session.userId));

  const access = await getListAccess(listId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }

  const tasks = await getTasksForList(
    listId,
    req.session.userId,
    access.role
  );
  return res.json({ tasks });
});

app.post('/api/tasks', authRequired, async (req, res) => {
  const { title, description, priority, deadline, tags, listId } =
    req.body || {};
  if (!title || String(title).trim().length === 0) {
    return res.status(400).json({ error: 'Title required' });
  }

  const targetListId =
    parseListId(listId) || (await getDefaultListId(req.session.userId));
  const access = await getListAccess(targetListId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  const cleanTags = normalizeTags(tags);
  const now = new Date().toISOString();
  const chosenPriority = clampPriority(priority);
  const deadlineValue = deadline ? String(deadline) : null;

  await db.exec('BEGIN');
  try {
    const result = await db.run(
      `
      INSERT INTO tasks (list_id, user_id, title, description, priority, deadline, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `,
      [
        targetListId,
        req.session.userId,
        String(title).trim(),
        description ? String(description).trim() : null,
        chosenPriority,
        deadlineValue,
        now,
        now,
      ]
    );

    const taskId = result.lastID;

    if (cleanTags.length > 0) {
      const tagIds = await ensureTags(req.session.userId, cleanTags);
      for (const tagId of tagIds) {
        await db.run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)', [
          taskId,
          tagId,
        ]);
      }
    }

    await db.exec('COMMIT');

    const tasks = await getTasksForList(
      targetListId,
      req.session.userId,
      access.role
    );
    return res.status(201).json({ tasks });
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/api/tasks/:id', authRequired, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const access = await getListAccess(task.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }

  const { title, description, priority, deadline, completed, tags } =
    req.body || {};

  if (access.role === 'viewer') {
    if (completed === undefined) {
      return res
        .status(400)
        .json({ error: 'Viewer can only update completion' });
    }
    const now = new Date().toISOString();
    await db.run(
      `
      INSERT INTO task_user_status (task_id, user_id, completed, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id, user_id) DO UPDATE SET completed = excluded.completed, updated_at = excluded.updated_at
    `,
      [taskId, req.session.userId, completed ? 1 : 0, now]
    );
    const tasks = await getTasksForList(
      task.list_id,
      req.session.userId,
      access.role
    );
    return res.json({ tasks });
  }

  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  const updates = {
    title: title !== undefined ? String(title).trim() : task.title,
    description:
      description !== undefined
        ? String(description).trim()
        : task.description,
    priority: priority !== undefined ? clampPriority(priority) : task.priority,
    deadline:
      deadline !== undefined
        ? deadline
          ? String(deadline)
          : null
        : task.deadline,
    completed:
      completed !== undefined ? (completed ? 1 : 0) : task.completed,
  };

  const now = new Date().toISOString();

  await db.exec('BEGIN');
  try {
    await db.run(
      `
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, deadline = ?, completed = ?, updated_at = ?
      WHERE id = ?
      `,
      [
        updates.title,
        updates.description,
        updates.priority,
        updates.deadline,
        updates.completed,
        now,
        taskId,
      ]
    );

    if (tags !== undefined) {
      const cleanTags = normalizeTags(tags);
      await db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId]);
      if (cleanTags.length > 0) {
        const tagIds = await ensureTags(req.session.userId, cleanTags);
        for (const tagId of tagIds) {
          await db.run(
            'INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)',
            [taskId, tagId]
          );
        }
      }
    }

    await db.exec('COMMIT');

    const tasks = await getTasksForList(
      task.list_id,
      req.session.userId,
      access.role
    );
    return res.json({ tasks });
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', authRequired, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const access = await getListAccess(task.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);

  const tasks = await getTasksForList(
    task.list_id,
    req.session.userId,
    access.role
  );
  return res.json({ tasks });
});

app.post('/api/tasks/:id/subtasks', authRequired, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const task = await db.get('SELECT id, list_id FROM tasks WHERE id = ?', [
    taskId,
  ]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const access = await getListAccess(task.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  const { title } = req.body || {};
  if (!title || String(title).trim().length === 0) {
    return res.status(400).json({ error: 'Subtask title required' });
  }

  const position = await getNextSubtaskPosition(taskId);
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO subtasks (task_id, title, completed, position, created_at) VALUES (?, ?, 0, ?, ?)',
    [taskId, String(title).trim(), position, now]
  );

  const tasks = await getTasksForList(
    task.list_id,
    req.session.userId,
    access.role
  );
  return res.status(201).json({ tasks });
});

app.patch('/api/subtasks/:id', authRequired, async (req, res) => {
  const subtaskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(subtaskId)) {
    return res.status(400).json({ error: 'Invalid subtask id' });
  }

  const subtask = await db.get(
    `
    SELECT s.id, s.task_id, s.title, s.completed, t.list_id
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    WHERE s.id = ?
  `,
    [subtaskId]
  );
  if (!subtask) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  const access = await getListAccess(subtask.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  const { title, completed } = req.body || {};

  if (access.role === 'viewer') {
    if (completed === undefined) {
      return res
        .status(400)
        .json({ error: 'Viewer can only update completion' });
    }
    const now = new Date().toISOString();
    await db.run(
      `
      INSERT INTO subtask_user_status (subtask_id, user_id, completed, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(subtask_id, user_id) DO UPDATE SET completed = excluded.completed, updated_at = excluded.updated_at
    `,
      [subtaskId, req.session.userId, completed ? 1 : 0, now]
    );
  } else {
    if (!canEdit(access.role)) {
      return res.status(403).json({ error: 'Read only list' });
    }
    const updates = {
      title: title !== undefined ? String(title).trim() : subtask.title,
      completed:
        completed !== undefined ? (completed ? 1 : 0) : subtask.completed,
    };

    await db.run(
      'UPDATE subtasks SET title = ?, completed = ? WHERE id = ?',
      [updates.title, updates.completed, subtaskId]
    );
  }

  const tasks = await getTasksForList(
    subtask.list_id,
    req.session.userId,
    access.role
  );
  return res.json({ tasks });
});

app.delete('/api/subtasks/:id', authRequired, async (req, res) => {
  const subtaskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(subtaskId)) {
    return res.status(400).json({ error: 'Invalid subtask id' });
  }

  const subtask = await db.get(
    `
    SELECT s.id, s.task_id, t.list_id
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    WHERE s.id = ?
  `,
    [subtaskId]
  );
  if (!subtask) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  const access = await getListAccess(subtask.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  await db.run('DELETE FROM subtasks WHERE id = ?', [subtaskId]);

  const tasks = await getTasksForList(
    subtask.list_id,
    req.session.userId,
    access.role
  );
  return res.json({ tasks });
});

app.patch('/api/tasks/:id/subtasks/reorder', authRequired, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'Ordered ids required' });
  }

  const task = await db.get('SELECT id, list_id FROM tasks WHERE id = ?', [
    taskId,
  ]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const access = await getListAccess(task.list_id, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }
  if (!canEdit(access.role)) {
    return res.status(403).json({ error: 'Read only list' });
  }

  const subs = await db.all('SELECT id FROM subtasks WHERE task_id = ?', [
    taskId,
  ]);
  const existingIds = subs.map((sub) => sub.id).sort((a, b) => a - b);
  const nextIds = orderedIds.map((id) => Number.parseInt(id, 10));
  if (nextIds.some((id) => Number.isNaN(id))) {
    return res.status(400).json({ error: 'Invalid subtask id in list' });
  }
  const sortedNext = [...nextIds].sort((a, b) => a - b);
  if (
    existingIds.length !== sortedNext.length ||
    existingIds.some((id, index) => id !== sortedNext[index])
  ) {
    return res.status(400).json({ error: 'Subtask list mismatch' });
  }

  await db.exec('BEGIN');
  try {
    for (let index = 0; index < nextIds.length; index += 1) {
      await db.run('UPDATE subtasks SET position = ? WHERE id = ?', [
        index + 1,
        nextIds[index],
      ]);
    }
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to reorder subtasks' });
  }

  const tasks = await getTasksForList(
    task.list_id,
    req.session.userId,
    access.role
  );
  return res.json({ tasks });
});

app.get('/api/export/csv', authRequired, async (req, res) => {
  const listId = parseListId(req.query.listId) ||
    (await getDefaultListId(req.session.userId));

  const access = await getListAccess(listId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }

  const tasks = await getTasksForList(listId, req.session.userId, access.role);
  const header = [
    'Task',
    'Description',
    'Priority',
    'Deadline',
    'Completed',
    'Tags',
    'Subtasks',
  ];

  const rows = tasks.map((task) => {
    const subtasks = task.subtasks
      .map((sub) => `${sub.completed ? '[x]' : '[ ]'} ${sub.title}`)
      .join('; ');
    return [
      task.title,
      task.description || '',
      task.priority,
      task.deadline || '',
      task.completed ? 'yes' : 'no',
      task.tags.join(', '),
      subtasks,
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  const safeName = access.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
  const filename = `focustask-${safeName || 'lista'}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${csv}`);
});

app.get('/api/export/pdf', authRequired, async (req, res) => {
  const listId = parseListId(req.query.listId) ||
    (await getDefaultListId(req.session.userId));

  const access = await getListAccess(listId, req.session.userId);
  if (!access) {
    return res.status(404).json({ error: 'List not found' });
  }

  const tasks = await getTasksForList(listId, req.session.userId, access.role);
  const safeName = access.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
  const filename = `focustask-${safeName || 'lista'}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40 });
  const fontPath = resolvePdfFont();
  if (fontPath) {
    doc.font(fontPath);
  }
  doc.pipe(res);

  doc.fontSize(18).text(`Lista: ${access.name}`, { underline: true });
  doc.moveDown();

  if (tasks.length === 0) {
    doc.fontSize(12).text('Brak zadan.');
    doc.end();
    return;
  }

  tasks.forEach((task, index) => {
    doc.fontSize(14).text(`${index + 1}. ${task.title}`, { continued: false });
    doc.fontSize(10).text(
      `Priorytet: ${priorityLabel(task.priority)} | Wykonane: ${
        task.completed ? 'Tak' : 'Nie'
      }`
    );
    doc.fontSize(10).text(`Deadline: ${task.deadline || 'Brak'}`);
    if (task.description) {
      doc.fontSize(10).text(`Opis: ${task.description}`);
    }
    if (task.tags.length > 0) {
      doc.fontSize(10).text(`Tagi: ${task.tags.join(', ')}`);
    }

    if (task.subtasks.length > 0) {
      doc.fontSize(10).text('Podzadania:');
      task.subtasks.forEach((sub) => {
        doc.text(`- ${sub.completed ? '[x]' : '[ ]'} ${sub.title}`, {
          indent: 14,
        });
      });
    }

    doc.moveDown();
  });

  doc.end();
});

initDb()
  .then((database) => {
    db = database;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });

