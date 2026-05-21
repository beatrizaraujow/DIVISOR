const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const {
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
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

function toIso(date) {
  return new Date(date).toISOString();
}

function startOfWeek(date) {
  const base = new Date(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
}

function endOfWeek(date) {
  const base = startOfWeek(date);
  base.setDate(base.getDate() + 7);
  return base;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Nao autenticado.' });
  }
  next();
}

function currentUser(req) {
  return req.session.userId ? findUserById(req.session.userId) : null;
}

function buildDashboard(now = new Date()) {
  const companies = listCompanies();
  const users = listUsers();
  const weekFrom = toIso(startOfWeek(now));
  const weekTo = toIso(endOfWeek(now));
  const monthFrom = toIso(startOfMonth(now));
  const monthTo = toIso(endOfMonth(now));

  const weekEntries = listEntries({ from: weekFrom, to: weekTo });
  const monthEntries = listEntries({ from: monthFrom, to: monthTo });

  const totals = {
    teamWeekMinutes: weekEntries.reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
    teamMonthMinutes: monthEntries.reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
  };

  const ranking = users.map(user => ({
    id: user.id,
    name: user.name,
    role: user.role,
    weekMinutes: weekEntries
      .filter(entry => entry.userId === user.id)
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
    monthMinutes: monthEntries
      .filter(entry => entry.userId === user.id)
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
    activeEntry: getActiveEntryForUser(user.id),
  })).sort((a, b) => b.weekMinutes - a.weekMinutes || b.monthMinutes - a.monthMinutes);

  const companyStats = companies.map(company => ({
    id: company.id,
    name: company.name,
    slug: company.slug,
    weekMinutes: weekEntries
      .filter(entry => entry.companyId === company.id)
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
    monthMinutes: monthEntries
      .filter(entry => entry.companyId === company.id)
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0),
  }));

  return { totals, ranking, companyStats };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function main() {
  await initDb();

  app.use(express.json());
  app.use(session({
    secret: 'team-hours-local-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 12,
    },
  }));

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/session', (req, res) => {
    const user = currentUser(req);
    res.json({
      authenticated: Boolean(user),
      user,
      companies: listCompanies(),
      users: user ? listUsers() : [],
    });
  });

  app.post('/api/login', async (req, res) => {
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = findUserByLogin(login);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Login ou senha invalidos.' });
    }

    req.session.userId = Number(user.id);
    res.json({ user: findUserById(user.id), companies: listCompanies(), users: listUsers() });
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get('/api/dashboard', requireAuth, (req, res) => {
    const user = currentUser(req);
    const now = new Date();
    const weekFrom = toIso(startOfWeek(now));
    const weekTo = toIso(endOfWeek(now));
    const monthFrom = toIso(startOfMonth(now));
    const monthTo = toIso(endOfMonth(now));

    const userWeekMinutes = listEntries({ from: weekFrom, to: weekTo, userId: user.id })
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0);
    const userMonthMinutes = listEntries({ from: monthFrom, to: monthTo, userId: user.id })
      .reduce((sum, entry) => sum + diffMinutes(entry.startAt, entry.endAt), 0);

    res.json({
      user,
      activeEntry: getActiveEntryForUser(user.id),
      userWeekMinutes,
      userMonthMinutes,
      recentEntries: listEntries({ userId: user.id }).slice(0, 10),
      ...buildDashboard(now),
    });
  });

  app.post('/api/timer/start', requireAuth, (req, res) => {
    const user = currentUser(req);
    const companyId = Number(req.body.companyId);
    const company = getCompanyById(companyId);
    if (!company) {
      return res.status(400).json({ error: 'Empresa invalida.' });
    }
    if (getActiveEntryForUser(user.id)) {
      return res.status(409).json({ error: 'Ja existe um relogio em andamento para este usuario.' });
    }

    const entry = createTimeEntry(user.id, companyId, new Date().toISOString());
    res.status(201).json({ entry });
  });

  app.post('/api/timer/stop', requireAuth, (req, res) => {
    const user = currentUser(req);
    const entry = stopActiveEntry(user.id, new Date().toISOString());
    if (!entry) {
      return res.status(409).json({ error: 'Nenhum relogio ativo para encerrar.' });
    }
    res.json({ entry });
  });

  app.get('/api/reports', requireAuth, (req, res) => {
    const from = req.query.from ? new Date(req.query.from).toISOString() : null;
    const to = req.query.to ? new Date(req.query.to).toISOString() : null;
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;

    const entries = listEntries({ from, to, userId, companyId });
    const summary = getReportSummary({ from, to, userId, companyId });

    res.json({
      filters: { from, to, userId, companyId },
      summary,
      entries,
    });
  });

  app.get('/api/reports/export', requireAuth, (req, res) => {
    const from = req.query.from ? new Date(req.query.from).toISOString() : null;
    const to = req.query.to ? new Date(req.query.to).toISOString() : null;
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;

    const entries = listEntries({ from, to, userId, companyId });
    const lines = [
      ['id', 'colaborador', 'empresa', 'inicio', 'fim', 'minutos'],
      ...entries.map(entry => [
        entry.id,
        entry.userName,
        entry.companyName,
        entry.startAt,
        entry.endAt || '',
        diffMinutes(entry.startAt, entry.endAt),
      ])
    ];

    const csv = lines.map(line => line.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio-horas.csv"');
    res.send(csv);
  });

  app.delete('/api/entries/:id', requireAuth, (req, res) => {
    const user = currentUser(req);
    const entryId = Number(req.params.id);
    const entry = getEntryById(entryId);

    if (!entry) {
      return res.status(404).json({ error: 'Registro nao encontrado.' });
    }
    if (entry.userId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissao para excluir este registro.' });
    }
    if (!entry.endAt) {
      return res.status(409).json({ error: 'Nao e possivel excluir um relogio ativo.' });
    }

    deleteEntry(entryId);
    res.json({ ok: true });
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Servidor iniciado em http://localhost:${PORT}`);
  });
}

main().catch(error => {
  console.error('Falha ao iniciar a aplicacao:', error);
  process.exit(1);
});