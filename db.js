const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'team-hours.db');

const SEED_USERS = [
  { name: 'Ana Beatriz', login: 'ana', password: '1234', role: 'admin' },
  { name: 'Bruno Costa', login: 'bruno', password: '1234', role: 'member' },
  { name: 'Carla Souza', login: 'carla', password: '1234', role: 'member' },
  { name: 'Diego Lima', login: 'diego', password: '1234', role: 'member' },
  { name: 'Elisa Rocha', login: 'elisa', password: '1234', role: 'member' },
  { name: 'Felipe Nunes', login: 'felipe', password: '1234', role: 'member' },
  { name: 'Giovana Alves', login: 'giovana', password: '1234', role: 'member' },
  { name: 'Hugo Martins', login: 'hugo', password: '1234', role: 'member' },
];

const SEED_COMPANIES = [
  { name: 'Carbone', slug: 'carbone' },
  { name: 'Seubone', slug: 'seubone' },
  { name: 'Onevo', slug: 'onevo' },
];

let SQL;
let db;

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function persist() {
  ensureDir();
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];

  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }

  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

async function initDb() {
  if (db) return;

  SQL = await initSqlJs();
  ensureDir();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );
  `);

  const userCount = queryOne('SELECT COUNT(*) AS count FROM users');
  if (!Number(userCount.count)) {
    SEED_USERS.forEach(user => {
      run(
        'INSERT INTO users (name, login, password_hash, role) VALUES (?, ?, ?, ?)',
        [user.name, user.login, bcrypt.hashSync(user.password, 10), user.role]
      );
    });
  }

  const companyCount = queryOne('SELECT COUNT(*) AS count FROM companies');
  if (!Number(companyCount.count)) {
    SEED_COMPANIES.forEach(company => {
      run(
        'INSERT INTO companies (name, slug) VALUES (?, ?)',
        [company.name, company.slug]
      );
    });
  }

  persist();
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    name: user.name,
    login: user.login,
    role: user.role,
  };
}

function listUsers() {
  return queryAll('SELECT id, name, login, role FROM users ORDER BY name ASC').map(sanitizeUser);
}

function listCompanies() {
  return queryAll('SELECT id, name, slug FROM companies ORDER BY name ASC').map(company => ({
    id: Number(company.id),
    name: company.name,
    slug: company.slug,
  }));
}

function findUserByLogin(login) {
  return queryOne('SELECT * FROM users WHERE login = ?', [login]);
}

function findUserById(id) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  return user ? sanitizeUser(user) : null;
}

function getUserWithPassword(id) {
  return queryOne('SELECT * FROM users WHERE id = ?', [id]);
}

function getCompanyById(id) {
  const company = queryOne('SELECT id, name, slug FROM companies WHERE id = ?', [id]);
  if (!company) return null;
  return { id: Number(company.id), name: company.name, slug: company.slug };
}

function getActiveEntryForUser(userId) {
  const entry = queryOne(
    `SELECT te.id, te.user_id, te.company_id, te.start_at, te.end_at, c.name AS company_name
     FROM time_entries te
     JOIN companies c ON c.id = te.company_id
     WHERE te.user_id = ? AND te.end_at IS NULL
     ORDER BY te.start_at DESC
     LIMIT 1`,
    [userId]
  );

  return entry ? mapEntry(entry) : null;
}

function createTimeEntry(userId, companyId, startAt) {
  run(
    'INSERT INTO time_entries (user_id, company_id, start_at) VALUES (?, ?, ?)',
    [userId, companyId, startAt]
  );

  return getActiveEntryForUser(userId);
}

function stopActiveEntry(userId, endAt) {
  const active = getActiveEntryForUser(userId);
  if (!active) return null;

  run('UPDATE time_entries SET end_at = ? WHERE id = ?', [endAt, active.id]);
  return getEntryById(active.id);
}

function deleteEntry(entryId) {
  run('DELETE FROM time_entries WHERE id = ?', [entryId]);
}

function getEntryById(entryId) {
  const entry = queryOne(
    `SELECT te.id, te.user_id, te.company_id, te.start_at, te.end_at,
            u.name AS user_name, c.name AS company_name
     FROM time_entries te
     JOIN users u ON u.id = te.user_id
     JOIN companies c ON c.id = te.company_id
     WHERE te.id = ?`,
    [entryId]
  );

  return entry ? mapEntry(entry) : null;
}

function mapEntry(entry) {
  return {
    id: Number(entry.id),
    userId: Number(entry.user_id),
    companyId: Number(entry.company_id),
    userName: entry.user_name || null,
    companyName: entry.company_name || null,
    startAt: entry.start_at,
    endAt: entry.end_at || null,
  };
}

function listEntries({ from, to, userId, companyId }) {
  const conditions = [];
  const params = [];

  if (from) {
    conditions.push('te.start_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('te.start_at < ?');
    params.push(to);
  }
  if (userId) {
    conditions.push('te.user_id = ?');
    params.push(userId);
  }
  if (companyId) {
    conditions.push('te.company_id = ?');
    params.push(companyId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = queryAll(
    `SELECT te.id, te.user_id, te.company_id, te.start_at, te.end_at,
            u.name AS user_name, c.name AS company_name
     FROM time_entries te
     JOIN users u ON u.id = te.user_id
     JOIN companies c ON c.id = te.company_id
     ${where}
     ORDER BY te.start_at DESC`,
    params
  );

  return rows.map(mapEntry);
}

function getReportSummary({ from, to, userId, companyId }) {
  const entries = listEntries({ from, to, userId, companyId });
  const totalsByUser = new Map();
  const totalsByCompany = new Map();
  const totalsByDay = new Map();

  entries.forEach(entry => {
    const minutes = diffMinutes(entry.startAt, entry.endAt);
    const day = entry.startAt.slice(0, 10);

    totalsByUser.set(entry.userName, (totalsByUser.get(entry.userName) || 0) + minutes);
    totalsByCompany.set(entry.companyName, (totalsByCompany.get(entry.companyName) || 0) + minutes);
    totalsByDay.set(day, (totalsByDay.get(day) || 0) + minutes);
  });

  return {
    totalMinutes: entries.reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
    entriesCount: entries.length,
    byUser: mapTotals(totalsByUser),
    byCompany: mapTotals(totalsByCompany),
    byDay: mapTotals(totalsByDay),
  };
}

function mapTotals(map) {
  return [...map.entries()]
    .map(([label, minutes]) => ({ label, minutes }))
    .sort((a, b) => b.minutes - a.minutes || String(a.label).localeCompare(String(b.label)));
}

function diffMinutes(startAt, endAt) {
  if (!startAt || !endAt) return 0;
  const diff = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Math.max(0, Math.round(diff / 60000));
}

module.exports = {
  initDb,
  listUsers,
  listCompanies,
  findUserByLogin,
  findUserById,
  getUserWithPassword,
  getCompanyById,
  getActiveEntryForUser,
  createTimeEntry,
  stopActiveEntry,
  deleteEntry,
  getEntryById,
  listEntries,
  getReportSummary,
  diffMinutes,
};