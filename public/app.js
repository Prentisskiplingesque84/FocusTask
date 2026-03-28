const authSection = document.getElementById('authSection');
const mainSection = document.getElementById('mainSection');
const userBox = document.getElementById('userBox');
const userLabel = document.getElementById('userLabel');
const authMsg = document.getElementById('authMsg');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabs = document.querySelectorAll('.tab');

const taskForm = document.getElementById('taskForm');
const taskSubmit = document.getElementById('taskSubmit');
const taskCancel = document.getElementById('taskCancel');
const tasksList = document.getElementById('tasksList');
const taskCount = document.getElementById('taskCount');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const priorityFilter = document.getElementById('priorityFilter');
const tagFilter = document.getElementById('tagFilter');
const statsEl = document.getElementById('stats');
const notifBtn = document.getElementById('notifBtn');
const notifStatus = document.getElementById('notifStatus');
const notifList = document.getElementById('notifList');

const listSelect = document.getElementById('listSelect');
const newListToggle = document.getElementById('newListToggle');
const newListForm = document.getElementById('newListForm');
const newListName = document.getElementById('newListName');
const newListCancel = document.getElementById('newListCancel');
const listRoleInfo = document.getElementById('listRoleInfo');

const shareForm = document.getElementById('shareForm');
const shareInfo = document.getElementById('shareInfo');
const shareUsername = document.getElementById('shareUsername');
const shareRole = document.getElementById('shareRole');
const shareMsg = document.getElementById('shareMsg');
const membersList = document.getElementById('membersList');
const inviteList = document.getElementById('inviteList');

const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');

const pomodoroTimer = document.getElementById('pomodoroTimer');
const pomodoroMode = document.getElementById('pomodoroMode');
const pomodoroStart = document.getElementById('pomodoroStart');
const pomodoroPause = document.getElementById('pomodoroPause');
const pomodoroReset = document.getElementById('pomodoroReset');
const pomodoroInfo = document.getElementById('pomodoroInfo');
const workMinutesInput = document.getElementById('workMinutes');
const breakMinutesInput = document.getElementById('breakMinutes');

const state = {
  user: null,
  tasks: [],
  lists: [],
  currentListId: null,
  editingId: null,
};

let draggingSubtask = null;
let draggingTaskId = null;

const notified = new Set(
  JSON.parse(localStorage.getItem('notifiedTasks') || '[]')
);

function saveNotified() {
  localStorage.setItem('notifiedTasks', JSON.stringify(Array.from(notified)));
}

async function api(path, options = {}) {
  const opts = {
    credentials: 'same-origin',
    headers: {},
    ...options,
  };

  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function setAuthMessage(text) {
  authMsg.textContent = text;
}

function clearAuthMessage() {
  authMsg.textContent = '';
}

function showMain(isLoggedIn) {
  authSection.classList.toggle('hidden', isLoggedIn);
  mainSection.classList.toggle('hidden', !isLoggedIn);
  userBox.classList.toggle('hidden', !isLoggedIn);
  if (isLoggedIn && state.user) {
    userLabel.textContent = `Zalogowany: ${state.user.username}`;
  } else {
    userLabel.textContent = '';
  }
}

function currentList() {
  return state.lists.find((list) => list.id === state.currentListId) || null;
}

function canEditCurrentList() {
  const list = currentList();
  return list && list.role !== 'viewer';
}

function canToggleCompletion() {
  return Boolean(currentList());
}

function formatDeadline(deadline) {
  if (!deadline) return 'Brak deadline';
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return deadline;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function priorityLabel(priority) {
  if (priority === 3) return 'Wysoki';
  if (priority === 1) return 'Niski';
  return 'Sredni';
}

function renderTagFilter(tasks) {
  const tags = new Set();
  tasks.forEach((task) => {
    task.tags.forEach((tag) => tags.add(tag));
  });

  const current = tagFilter.value;
  tagFilter.innerHTML = '<option value="all">Tag</option>';
  Array.from(tags)
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      tagFilter.appendChild(option);
    });

  if (Array.from(tags).includes(current)) {
    tagFilter.value = current;
  }
}

function applyFilters(tasks) {
  let filtered = [...tasks];
  const term = searchInput.value.trim().toLowerCase();

  if (statusFilter.value === 'active') {
    filtered = filtered.filter((task) => !task.completed);
  }
  if (statusFilter.value === 'done') {
    filtered = filtered.filter((task) => task.completed);
  }
  if (priorityFilter.value !== 'all') {
    const prio = Number.parseInt(priorityFilter.value, 10);
    filtered = filtered.filter((task) => task.priority === prio);
  }
  if (tagFilter.value !== 'all') {
    filtered = filtered.filter((task) => task.tags.includes(tagFilter.value));
  }
  if (term) {
    filtered = filtered.filter((task) => {
      const hay = `${task.title} ${task.description || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }

  return filtered;
}

function renderTasks() {
  const filtered = applyFilters(state.tasks);
  const editable = canEditCurrentList();
  const canToggle = canToggleCompletion();
  tasksList.innerHTML = '';
  taskCount.textContent = String(filtered.length);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Brak zadan do wyswietlenia.';
    tasksList.appendChild(empty);
    return;
  }

  filtered.forEach((task) => {
    const card = document.createElement('div');
    card.className = `task-card${task.completed ? ' done' : ''}`;

    const top = document.createElement('div');
    top.className = 'task-top';

    const info = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;

    const desc = document.createElement('div');
    desc.className = 'muted';
    desc.textContent = task.description || 'Brak opisu.';

    info.appendChild(title);
    info.appendChild(desc);

    const toggleWrap = document.createElement('label');
    toggleWrap.style.display = 'flex';
    toggleWrap.style.gap = '8px';
    toggleWrap.style.alignItems = 'center';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.dataset.action = 'toggle';
    toggle.dataset.id = task.id;
    toggle.checked = task.completed;
    toggle.disabled = !canToggle;

    const toggleText = document.createElement('span');
    toggleText.className = 'muted';
    toggleText.textContent = task.completed ? 'Zrobione' : 'Do zrobienia';

    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(toggleText);

    top.appendChild(info);
    top.appendChild(toggleWrap);

    const badges = document.createElement('div');
    badges.className = 'badges';

    const priority = document.createElement('span');
    priority.className = `badge ${
      task.priority === 3 ? 'high' : task.priority === 1 ? 'low' : ''
    }`;
    priority.textContent = `Priorytet: ${priorityLabel(task.priority)}`;
    badges.appendChild(priority);

    const deadline = document.createElement('div');
    deadline.className = 'deadline';
    deadline.textContent = `Deadline: ${formatDeadline(task.deadline)}`;

    const tagRow = document.createElement('div');
    tagRow.className = 'badges';
    if (task.tags.length === 0) {
      const emptyTag = document.createElement('span');
      emptyTag.className = 'muted';
      emptyTag.textContent = 'Brak tagow.';
      tagRow.appendChild(emptyTag);
    } else {
      task.tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = tag;
        tagRow.appendChild(chip);
      });
    }

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (editable) {
      const editBtn = document.createElement('button');
      editBtn.className = 'ghost';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.id = task.id;
      editBtn.textContent = 'Edytuj';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'ghost';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.dataset.id = task.id;
      deleteBtn.textContent = 'Usun';

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
    } else {
      const readonly = document.createElement('span');
      readonly.className = 'muted';
      readonly.textContent = canToggle
        ? 'Podglad (mozesz odhaczac).'
        : 'Tylko podglad.';
      actions.appendChild(readonly);
    }

    const subtasks = document.createElement('div');
    subtasks.className = 'subtasks';

    const progress = document.createElement('div');
    progress.className = 'subtask-progress';
    const doneCount = task.subtasks.filter((sub) => sub.completed).length;
    progress.textContent = `Podzadania: ${doneCount}/${task.subtasks.length}`;
    subtasks.appendChild(progress);

    const subList = document.createElement('div');
    subList.className = 'subtask-list';

    if (task.subtasks.length === 0) {
      const emptySub = document.createElement('span');
      emptySub.className = 'muted';
      emptySub.textContent = 'Brak podzadan.';
      subList.appendChild(emptySub);
    } else {
      task.subtasks.forEach((sub) => {
        const row = document.createElement('div');
        row.className = 'subtask-item';
        row.dataset.subtaskId = sub.id;
        row.dataset.taskId = task.id;
        row.draggable = editable;

        const left = document.createElement('div');
        left.className = 'subtask-left';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = sub.completed;
        checkbox.dataset.action = 'toggle-subtask';
        checkbox.dataset.subtaskId = sub.id;
        checkbox.disabled = !canToggle;

        const title = document.createElement('span');
        title.className = 'subtask-title';
        title.textContent = sub.title;

        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'subtask-edit hidden';
        editInput.value = sub.title;
        editInput.dataset.subtaskId = sub.id;

        left.appendChild(checkbox);
        left.appendChild(title);
        left.appendChild(editInput);

        const actions = document.createElement('div');
        actions.className = 'subtask-actions';

        if (editable) {
          const editBtn = document.createElement('button');
          editBtn.className = 'ghost';
          editBtn.dataset.action = 'edit-subtask';
          editBtn.dataset.subtaskId = sub.id;
          editBtn.textContent = 'Edytuj';

          const saveBtn = document.createElement('button');
          saveBtn.className = 'primary hidden';
          saveBtn.dataset.action = 'save-subtask';
          saveBtn.dataset.subtaskId = sub.id;
          saveBtn.textContent = 'Zapisz';

          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'ghost hidden';
          cancelBtn.dataset.action = 'cancel-subtask';
          cancelBtn.dataset.subtaskId = sub.id;
          cancelBtn.textContent = 'Anuluj';

          const removeBtn = document.createElement('button');
          removeBtn.className = 'ghost';
          removeBtn.dataset.action = 'delete-subtask';
          removeBtn.dataset.subtaskId = sub.id;
          removeBtn.textContent = 'Usun';

          actions.appendChild(editBtn);
          actions.appendChild(saveBtn);
          actions.appendChild(cancelBtn);
          actions.appendChild(removeBtn);
        }

        row.appendChild(left);
        if (actions.childElementCount > 0) {
          row.appendChild(actions);
        }

        subList.appendChild(row);
      });
    }

    subtasks.appendChild(subList);

    if (editable) {
      const addRow = document.createElement('div');
      addRow.className = 'subtask-add';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Nowe podzadanie';
      input.dataset.role = 'subtask-input';
      input.dataset.taskId = task.id;

      const addBtn = document.createElement('button');
      addBtn.className = 'primary';
      addBtn.type = 'button';
      addBtn.dataset.action = 'add-subtask';
      addBtn.dataset.id = task.id;
      addBtn.textContent = 'Dodaj';

      addRow.appendChild(input);
      addRow.appendChild(addBtn);
      subtasks.appendChild(addRow);
    }

    card.appendChild(top);
    card.appendChild(badges);
    card.appendChild(deadline);
    card.appendChild(tagRow);
    card.appendChild(subtasks);
    card.appendChild(actions);

    tasksList.appendChild(card);
  });
}

function renderStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.completed).length;
  const active = total - done;
  const high = state.tasks.filter((task) => task.priority === 3).length;

  statsEl.innerHTML = '';
  const lines = [
    `Wszystkie zadania: ${total}`,
    `Aktywne: ${active}`,
    `Zakonczone: ${done}`,
    `Priorytet wysoki: ${high}`,
  ];
  lines.forEach((line) => {
    const item = document.createElement('div');
    item.textContent = line;
    statsEl.appendChild(item);
  });
}

function renderNotifications() {
  const dueSoon = getDueSoonTasks(90);
  notifList.innerHTML = '';

  if (dueSoon.length === 0) {
    notifStatus.textContent = 'Brak aktywnych przypomnien.';
    return;
  }

  notifStatus.textContent = `Zblizajace sie deadline: ${dueSoon.length}`;
  dueSoon.forEach((task) => {
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.textContent = `${task.title} - ${formatDeadline(task.deadline)}`;
    notifList.appendChild(item);
  });
}

function renderAll() {
  renderTagFilter(state.tasks);
  renderTasks();
  renderStats();
  renderNotifications();
}

function resetTaskForm() {
  taskForm.reset();
  taskForm.taskId.value = '';
  state.editingId = null;
  taskSubmit.textContent = 'Dodaj zadanie';
  taskCancel.classList.add('hidden');
}

function updateTaskFormAccess() {
  const editable = canEditCurrentList();
  const inputs = taskForm.querySelectorAll('input, textarea, select, button');
  inputs.forEach((input) => {
    input.disabled = !editable;
  });

  if (!editable) {
    listRoleInfo.textContent =
      'Ta lista jest tylko do podgladu. Mozesz oznaczac zadania i podzadania jako zrobione.';
    listRoleInfo.classList.remove('hidden');
    resetTaskForm();
  } else {
    listRoleInfo.classList.add('hidden');
  }
}

function renderListSelect() {
  listSelect.innerHTML = '';
  state.lists.forEach((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent =
      list.role === 'owner' ? list.name : `${list.name} (udostepniona)`;
    listSelect.appendChild(option);
  });
  if (state.currentListId) {
    listSelect.value = String(state.currentListId);
  }
}

async function loadLists() {
  const data = await api('/api/lists');
  state.lists = data.lists || [];
  renderListSelect();

  const stored = localStorage.getItem('currentListId');
  const storedId = stored ? Number.parseInt(stored, 10) : null;
  const exists = state.lists.some((list) => list.id === storedId);
  const nextId = exists ? storedId : state.lists[0]?.id;

  if (nextId) {
    await selectList(nextId);
  } else {
    state.currentListId = null;
    state.tasks = [];
    renderAll();
  }
}

async function selectList(listId) {
  state.currentListId = listId;
  localStorage.setItem('currentListId', String(listId));
  renderListSelect();
  updateTaskFormAccess();
  await refreshTasks();
  await updateShareSection();
}

async function refreshTasks() {
  if (!state.currentListId) {
    state.tasks = [];
    renderAll();
    return;
  }
  const data = await api(`/api/tasks?listId=${state.currentListId}`);
  state.tasks = data.tasks || [];
  renderAll();
}

function getTaskById(id) {
  return state.tasks.find((task) => task.id === id);
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  if (!canEditCurrentList()) return;
  const formData = new FormData(taskForm);

  const payload = {
    title: formData.get('title'),
    description: formData.get('description'),
    priority: formData.get('priority'),
    deadline: formData.get('deadline') || null,
    tags: formData.get('tags'),
    listId: state.currentListId,
  };

  try {
    if (state.editingId) {
      await api(`/api/tasks/${state.editingId}`, {
        method: 'PATCH',
        body: payload,
      });
    } else {
      await api('/api/tasks', {
        method: 'POST',
        body: payload,
      });
    }
    resetTaskForm();
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleToggle(id, completed) {
  if (!canToggleCompletion()) return;
  try {
    await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: { completed },
    });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

function startEdit(task) {
  if (!canEditCurrentList()) return;
  taskForm.title.value = task.title;
  taskForm.description.value = task.description || '';
  taskForm.priority.value = String(task.priority);
  taskForm.deadline.value = task.deadline || '';
  taskForm.tags.value = task.tags.join(', ');
  taskForm.taskId.value = task.id;
  state.editingId = task.id;
  taskSubmit.textContent = 'Zapisz zmiany';
  taskCancel.classList.remove('hidden');
  taskForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleDelete(id) {
  if (!canEditCurrentList()) return;
  if (!confirm('Usunac to zadanie?')) return;
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleAddSubtask(taskId, title) {
  if (!canEditCurrentList()) return;
  if (!title || title.trim().length === 0) return;
  try {
    await api(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: { title },
    });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleToggleSubtask(subtaskId, completed) {
  if (!canToggleCompletion()) return;
  try {
    await api(`/api/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: { completed },
    });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleDeleteSubtask(subtaskId) {
  if (!canEditCurrentList()) return;
  if (!confirm('Usunac podzadanie?')) return;
  try {
    await api(`/api/subtasks/${subtaskId}`, { method: 'DELETE' });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleUpdateSubtaskTitle(subtaskId, title) {
  if (!canEditCurrentList()) return;
  if (!title || title.trim().length === 0) return;
  try {
    await api(`/api/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: { title },
    });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function handleReorderSubtasks(taskId, orderedIds) {
  if (!canEditCurrentList()) return;
  try {
    await api(`/api/tasks/${taskId}/subtasks/reorder`, {
      method: 'PATCH',
      body: { orderedIds },
    });
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

function setSubtaskEditMode(row, isEditing) {
  const title = row.querySelector('.subtask-title');
  const input = row.querySelector('.subtask-edit');
  const editBtn = row.querySelector('button[data-action="edit-subtask"]');
  const saveBtn = row.querySelector('button[data-action="save-subtask"]');
  const cancelBtn = row.querySelector('button[data-action="cancel-subtask"]');

  if (!title || !input || !editBtn || !saveBtn || !cancelBtn) return;

  if (isEditing) {
    input.value = title.textContent;
    input.classList.remove('hidden');
    title.classList.add('hidden');
    saveBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    editBtn.classList.add('hidden');
    input.focus();
    input.select();
  } else {
    input.classList.add('hidden');
    title.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    editBtn.classList.remove('hidden');
    input.value = title.textContent;
  }
}

function getDueSoonTasks(windowMinutes) {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  return state.tasks.filter((task) => {
    if (task.completed || !task.deadline) return false;
    const due = new Date(task.deadline).getTime();
    if (Number.isNaN(due)) return false;
    const diff = due - now;
    return diff > 0 && diff <= windowMs;
  });
}

function maybeNotify() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const dueSoon = getDueSoonTasks(60);
  dueSoon.forEach((task) => {
    const key = `${task.id}|${task.deadline}`;
    if (notified.has(key)) return;
    new Notification('Zblizajacy sie deadline', {
      body: `${task.title} - ${formatDeadline(task.deadline)}`,
    });
    notified.add(key);
  });
  saveNotified();
}

function updateNotifButton() {
  if (!('Notification' in window)) {
    notifBtn.disabled = true;
    notifBtn.textContent = 'Brak wsparcia';
    return;
  }
  notifBtn.textContent =
    Notification.permission === 'granted' ? 'Aktywne' : 'Wlacz';
}

async function handleLogin(event) {
  event.preventDefault();
  clearAuthMessage();
  const formData = new FormData(loginForm);
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: {
        username: formData.get('username'),
        password: formData.get('password'),
      },
    });
    state.user = data;
    showMain(true);
    await loadLists();
    await loadInvites();
  } catch (err) {
    setAuthMessage(err.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  clearAuthMessage();
  const formData = new FormData(registerForm);
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: {
        username: formData.get('username'),
        password: formData.get('password'),
      },
    });
    state.user = data;
    showMain(true);
    await loadLists();
    await loadInvites();
  } catch (err) {
    setAuthMessage(err.message);
  }
}

async function handleLogout() {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  state.tasks = [];
  state.lists = [];
  state.currentListId = null;
  listSelect.innerHTML = '';
  tasksList.innerHTML = '';
  membersList.innerHTML = '';
  inviteList.innerHTML = '';
  showMain(false);
}

function switchAuthTab(tab) {
  tabs.forEach((btn) => btn.classList.remove('active'));
  tab.classList.add('active');
  const mode = tab.dataset.auth;
  loginForm.classList.toggle('hidden', mode !== 'login');
  registerForm.classList.toggle('hidden', mode !== 'register');
  clearAuthMessage();
}

async function updateShareSection() {
  shareMsg.textContent = '';
  const list = currentList();
  if (!list) {
    shareInfo.textContent = 'Brak listy do udostepnienia.';
    shareForm.classList.add('hidden');
    membersList.innerHTML = '';
    return;
  }

  shareInfo.textContent =
    list.role === 'owner'
      ? 'Wyslij zaproszenie do listy i wybierz poziom dostepu.'
      : `Lista udostepniona przez: ${list.owner_username}`;

  shareForm.classList.toggle('hidden', list.role !== 'owner');
  await loadMembers();
}

async function loadMembers() {
  const list = currentList();
  if (!list) return;
  try {
    const data = await api(`/api/lists/${list.id}/members`);
    renderMembers(data.members || []);
  } catch (err) {
    membersList.innerHTML = '';
  }
}

function renderMembers(members) {
  const list = currentList();
  const isOwner = list && list.role === 'owner';
  membersList.innerHTML = '';

  if (members.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Brak udostepnionych osob.';
    membersList.appendChild(empty);
    return;
  }

  members.forEach((member) => {
    const item = document.createElement('div');
    item.className = 'member';

    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = member.username;
    const role = document.createElement('span');
    role.className = 'member-role';
    role.textContent = ` (${member.role})`;
    info.appendChild(name);
    info.appendChild(role);

    item.appendChild(info);

    if (isOwner && member.role !== 'owner') {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'ghost';
      removeBtn.dataset.action = 'remove-member';
      removeBtn.dataset.userId = member.id;
      removeBtn.textContent = 'Usun';
      item.appendChild(removeBtn);
    }

    membersList.appendChild(item);
  });
}

function renderInvites(invites) {
  inviteList.innerHTML = '';

  if (!invites || invites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Brak zaproszen.';
    inviteList.appendChild(empty);
    return;
  }

  invites.forEach((invite) => {
    const item = document.createElement('div');
    item.className = 'invite-item';

    const title = document.createElement('strong');
    title.textContent = invite.list_name;

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `Od: ${invite.owner_username} | Rola: ${invite.role}`;

    const actions = document.createElement('div');
    actions.className = 'invite-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'primary';
    acceptBtn.dataset.action = 'accept-invite';
    acceptBtn.dataset.inviteId = invite.id;
    acceptBtn.textContent = 'Akceptuj';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'ghost';
    declineBtn.dataset.action = 'decline-invite';
    declineBtn.dataset.inviteId = invite.id;
    declineBtn.textContent = 'Odrzuc';

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(actions);

    inviteList.appendChild(item);
  });
}

async function loadInvites() {
  if (!state.user) return;
  try {
    const data = await api('/api/invites');
    renderInvites(data.invites || []);
  } catch (err) {
    inviteList.innerHTML = '';
    const errorMsg = document.createElement('div');
    errorMsg.className = 'muted';
    errorMsg.textContent = 'Nie mozna pobrac zaproszen.';
    inviteList.appendChild(errorMsg);
  }
}

const pomodoro = {
  mode: 'work',
  running: false,
  remaining: 25 * 60,
  work: 25,
  break: 5,
  sessions: 0,
  interval: null,
};

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updatePomodoroDisplay() {
  pomodoroTimer.textContent = formatTime(pomodoro.remaining);
  pomodoroMode.textContent = pomodoro.mode === 'work' ? 'Praca' : 'Przerwa';
  pomodoroInfo.textContent = `Sesje ukonczone: ${pomodoro.sessions}`;
}

function setPomodoroFromInputs() {
  pomodoro.work = Math.max(10, Number.parseInt(workMinutesInput.value, 10) || 25);
  pomodoro.break = Math.max(3, Number.parseInt(breakMinutesInput.value, 10) || 5);
  if (!pomodoro.running) {
    pomodoro.remaining =
      pomodoro.mode === 'work' ? pomodoro.work * 60 : pomodoro.break * 60;
    updatePomodoroDisplay();
  }
}

function switchMode() {
  if (pomodoro.mode === 'work') {
    pomodoro.mode = 'break';
    pomodoro.remaining = pomodoro.break * 60;
    pomodoro.sessions += 1;
  } else {
    pomodoro.mode = 'work';
    pomodoro.remaining = pomodoro.work * 60;
  }
  updatePomodoroDisplay();
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Pomodoro', {
      body: pomodoro.mode === 'work' ? 'Czas na prace.' : 'Czas na przerwe.',
    });
  }
}

function tickPomodoro() {
  if (!pomodoro.running) return;
  pomodoro.remaining -= 1;
  if (pomodoro.remaining <= 0) {
    switchMode();
  } else {
    updatePomodoroDisplay();
  }
}

function startPomodoro() {
  if (pomodoro.running) return;
  setPomodoroFromInputs();
  pomodoro.running = true;
  pomodoro.interval = setInterval(tickPomodoro, 1000);
}

function pausePomodoro() {
  pomodoro.running = false;
  if (pomodoro.interval) {
    clearInterval(pomodoro.interval);
    pomodoro.interval = null;
  }
}

function resetPomodoro() {
  pausePomodoro();
  pomodoro.mode = 'work';
  pomodoro.remaining = pomodoro.work * 60;
  pomodoro.sessions = 0;
  updatePomodoroDisplay();
}

function initPomodoro() {
  updatePomodoroDisplay();
  workMinutesInput.addEventListener('change', setPomodoroFromInputs);
  breakMinutesInput.addEventListener('change', setPomodoroFromInputs);
  pomodoroStart.addEventListener('click', startPomodoro);
  pomodoroPause.addEventListener('click', pausePomodoro);
  pomodoroReset.addEventListener('click', resetPomodoro);
}

function setupEventListeners() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchAuthTab(tab));
  });
  loginForm.addEventListener('submit', handleLogin);
  registerForm.addEventListener('submit', handleRegister);
  taskForm.addEventListener('submit', handleTaskSubmit);
  taskCancel.addEventListener('click', resetTaskForm);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  [searchInput, statusFilter, priorityFilter, tagFilter].forEach((el) => {
    el.addEventListener('input', renderTasks);
  });

  listSelect.addEventListener('change', async () => {
    const id = Number.parseInt(listSelect.value, 10);
    if (!Number.isNaN(id)) {
      await selectList(id);
    }
  });

  newListToggle.addEventListener('click', () => {
    newListForm.classList.toggle('hidden');
    newListName.focus();
  });

  newListCancel.addEventListener('click', () => {
    newListForm.classList.add('hidden');
    newListForm.reset();
  });

  newListForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = newListName.value.trim();
    if (!name) return;
    try {
      const data = await api('/api/lists', {
        method: 'POST',
        body: { name },
      });
      newListForm.reset();
      newListForm.classList.add('hidden');
      await loadLists();
      await selectList(data.id);
    } catch (err) {
      alert(err.message);
    }
  });

  shareForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const list = currentList();
    if (!list || list.role !== 'owner') return;
    try {
      await api(`/api/lists/${list.id}/invites`, {
        method: 'POST',
        body: {
          username: shareUsername.value.trim(),
          role: shareRole.value,
        },
      });
      shareMsg.textContent = 'Zaproszenie wyslane.';
      shareUsername.value = '';
      await loadMembers();
      await loadLists();
    } catch (err) {
      shareMsg.textContent = err.message;
    }
  });

  membersList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="remove-member"]');
    if (!button) return;
    const list = currentList();
    if (!list || list.role !== 'owner') return;
    const memberId = Number.parseInt(button.dataset.userId, 10);
    if (Number.isNaN(memberId)) return;
    if (!confirm('Usunac dostep tej osoby?')) return;
    try {
      await api(`/api/lists/${list.id}/members/${memberId}`, {
        method: 'DELETE',
      });
      await loadMembers();
    } catch (err) {
      shareMsg.textContent = err.message;
    }
  });

  inviteList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const inviteId = Number.parseInt(button.dataset.inviteId, 10);
    if (Number.isNaN(inviteId)) return;

    try {
      if (button.dataset.action === 'accept-invite') {
        await api(`/api/invites/${inviteId}/accept`, { method: 'POST' });
      }
      if (button.dataset.action === 'decline-invite') {
        await api(`/api/invites/${inviteId}/decline`, { method: 'POST' });
      }
      await loadInvites();
      await loadLists();
    } catch (err) {
      alert(err.message);
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    if (!state.currentListId) return;
    window.location.href = `/api/export/csv?listId=${state.currentListId}`;
  });

  exportPdfBtn.addEventListener('click', () => {
    if (!state.currentListId) return;
    window.location.href = `/api/export/pdf?listId=${state.currentListId}`;
  });

  tasksList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'add-subtask') {
      const card = button.closest('.task-card');
      const input = card?.querySelector('input[data-role="subtask-input"]');
      if (!input) return;
      const taskId = Number.parseInt(button.dataset.id, 10);
      if (Number.isNaN(taskId)) return;
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      handleAddSubtask(taskId, title);
      return;
    }

    if (button.dataset.action === 'edit-subtask') {
      const row = button.closest('.subtask-item');
      if (row) {
        setSubtaskEditMode(row, true);
      }
      return;
    }

    if (button.dataset.action === 'save-subtask') {
      const row = button.closest('.subtask-item');
      if (!row) return;
      const input = row.querySelector('.subtask-edit');
      const subtaskId = Number.parseInt(button.dataset.subtaskId, 10);
      if (input && !Number.isNaN(subtaskId)) {
        handleUpdateSubtaskTitle(subtaskId, input.value.trim());
      }
      return;
    }

    if (button.dataset.action === 'cancel-subtask') {
      const row = button.closest('.subtask-item');
      if (row) {
        setSubtaskEditMode(row, false);
      }
      return;
    }

    if (button.dataset.action === 'delete-subtask') {
      const subtaskId = Number.parseInt(button.dataset.subtaskId, 10);
      if (!Number.isNaN(subtaskId)) {
        handleDeleteSubtask(subtaskId);
      }
      return;
    }

    const id = Number.parseInt(button.dataset.id, 10);
    if (Number.isNaN(id)) return;
    const task = getTaskById(id);
    if (!task) return;

    if (button.dataset.action === 'edit') {
      startEdit(task);
    }
    if (button.dataset.action === 'delete') {
      handleDelete(id);
    }
  });

  tasksList.addEventListener('change', (event) => {
    if (event.target.matches('input[data-action="toggle"]')) {
      const id = Number.parseInt(event.target.dataset.id, 10);
      handleToggle(id, event.target.checked);
    }

    if (event.target.matches('input[data-action="toggle-subtask"]')) {
      const subtaskId = Number.parseInt(event.target.dataset.subtaskId, 10);
      handleToggleSubtask(subtaskId, event.target.checked);
    }
  });

  tasksList.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const input = event.target.closest('input[data-role="subtask-input"]');
      if (input) {
        event.preventDefault();
        const taskId = Number.parseInt(input.dataset.taskId, 10);
        const title = input.value.trim();
        if (!Number.isNaN(taskId) && title) {
          input.value = '';
          handleAddSubtask(taskId, title);
        }
        return;
      }

      const editInput = event.target.closest('.subtask-edit');
      if (editInput) {
        event.preventDefault();
        const row = editInput.closest('.subtask-item');
        const subtaskId = Number.parseInt(editInput.dataset.subtaskId, 10);
        if (row && !Number.isNaN(subtaskId)) {
          handleUpdateSubtaskTitle(subtaskId, editInput.value.trim());
        }
      }
    }

    if (event.key === 'Escape') {
      const editInput = event.target.closest('.subtask-edit');
      if (editInput) {
        const row = editInput.closest('.subtask-item');
        if (row) {
          setSubtaskEditMode(row, false);
        }
      }
    }
  });

  tasksList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.subtask-item');
    if (!row || !canEditCurrentList()) return;
    draggingSubtask = row;
    draggingTaskId = Number.parseInt(row.dataset.taskId, 10);
    row.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
    }
  });

  tasksList.addEventListener('dragover', (event) => {
    if (!draggingSubtask || Number.isNaN(draggingTaskId)) return;
    const target = event.target.closest('.subtask-item');
    if (!target) return;
    const targetTaskId = Number.parseInt(target.dataset.taskId, 10);
    if (targetTaskId !== draggingTaskId) return;

    event.preventDefault();
    const list = target.parentElement;
    const rect = target.getBoundingClientRect();
    const shouldPlaceAfter = event.clientY > rect.top + rect.height / 2;

    if (shouldPlaceAfter) {
      if (target.nextSibling !== draggingSubtask) {
        list.insertBefore(draggingSubtask, target.nextSibling);
      }
    } else if (target !== draggingSubtask) {
      list.insertBefore(draggingSubtask, target);
    }
  });

  tasksList.addEventListener('drop', (event) => {
    if (!draggingSubtask || Number.isNaN(draggingTaskId)) return;
    event.preventDefault();
    const list = draggingSubtask.parentElement;
    const orderedIds = Array.from(
      list.querySelectorAll('.subtask-item')
    )
      .map((el) => Number.parseInt(el.dataset.subtaskId, 10))
      .filter((id) => !Number.isNaN(id));

    handleReorderSubtasks(draggingTaskId, orderedIds);
  });

  tasksList.addEventListener('dragend', () => {
    if (draggingSubtask) {
      draggingSubtask.classList.remove('dragging');
    }
    draggingSubtask = null;
    draggingTaskId = null;
  });

  notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      maybeNotify();
    }
    updateNotifButton();
  });
}

async function bootstrap() {
  setupEventListeners();
  initPomodoro();
  updateNotifButton();
  resetTaskForm();

  const data = await api('/api/me');
  if (data.user) {
    state.user = data.user;
    showMain(true);
    await loadLists();
    await loadInvites();
  } else {
    showMain(false);
  }

  setInterval(() => {
    if (!state.user) return;
    renderNotifications();
    maybeNotify();
    loadInvites();
  }, 60000);
}

bootstrap().catch(() => {
  setAuthMessage('Nie mozna polaczyc z serwerem.');
});
