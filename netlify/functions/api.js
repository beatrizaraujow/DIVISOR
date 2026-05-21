import bcrypt from 'bcryptjs';
import { buildSessionCookie, buildExpiredSessionCookie, getUserIdFromRequest } from './lib/auth.js';
import { readStateWithMeta, updateState } from './lib/store.js';

export const config = {
  path: ['/api/*'],
};

export default async function handler(req) {
  try {
    const stateMeta = await readStateWithMeta();
    const url = new URL(req.url);
    const route = normalizePath(url.pathname);
    const method = req.method.toUpperCase();

    if (method === 'GET' && route === '/session') {
      return handleSession(req, stateMeta.state);
    }
    if (method === 'POST' && route === '/login') {
      return await handleLogin(req, stateMeta.state);
    }
    if (method === 'POST' && route === '/logout') {
      return await requireAuth(req, stateMeta.state, () => handleLogout());
    }
    if (method === 'GET' && route === '/dashboard') {
      return await requireAuth(req, stateMeta.state, user => handleDashboard(stateMeta.state, user));
    }
    if (method === 'POST' && route === '/timer/start') {
      return await requireAuth(req, stateMeta.state, user => handleTimerStart(req, user));
    }
    if (method === 'POST' && route === '/timer/stop') {
      return await requireAuth(req, stateMeta.state, user => handleTimerStop(user));
    }
    if (method === 'GET' && route === '/reports') {
      return await requireAuth(req, stateMeta.state, user => handleReports(req, stateMeta.state, user));
    }
    if (method === 'GET' && route === '/reports/export') {
      return await requireAuth(req, stateMeta.state, user => handleReportExport(req, stateMeta.state, user));
    }
    if (method === 'DELETE' && route.startsWith('/entries/')) {
      return await requireAuth(req, stateMeta.state, user => handleDeleteEntry(route, stateMeta.state, user));
    }

    return json(404, { error: 'Rota nao encontrada.' });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || 'Erro interno do servidor.' });
  }
}

function normalizePath(pathname = '') {
  const prefixes = ['/.netlify/functions/api', '/api'];
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      return rest || '/';
    }
  }
  return pathname || '/';
}

function json(statusCode, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function text(statusCode, body, extraHeaders = {}) {
  return new Response(body, {
    status: statusCode,
    headers: extraHeaders,
  });
}

async function parseJsonBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
  };
}

function listUsers(state) {
  return state.users
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(publicUser);
}

function listCompanies(state) {
  return state.companies
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(company => ({ id: company.id, name: company.name, slug: company.slug }));
}

function findUserById(state, userId) {
  return state.users.find(user => user.id === Number(userId)) || null;
}

function findUserByLogin(state, login) {
  return state.users.find(user => user.login === login) || null;
}

function findCompanyById(state, companyId) {
  return state.companies.find(company => company.id === Number(companyId)) || null;
}

function requireAuth(req, state, callback) {
  const userId = getUserIdFromRequest(req);
  const user = userId ? findUserById(state, userId) : null;
  if (!user) {
    return json(401, { error: 'Nao autenticado.' });
  }
  return callback(publicUser(user));
}

function handleSession(req, state) {
  const userId = getUserIdFromRequest(req);
  const user = userId ? findUserById(state, userId) : null;
  return json(200, {
    authenticated: Boolean(user),
    user: publicUser(user),
    companies: listCompanies(state),
    users: user ? listUsers(state) : [],
  });
}

async function handleLogin(req, state) {
  const body = await parseJsonBody(req);
  const login = String(body.login || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = findUserByLogin(state, login);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return json(401, { error: 'Login ou senha invalidos.' });
  }

  return json(
    200,
    {
      user: publicUser(user),
      companies: listCompanies(state),
      users: listUsers(state),
    },
    { 'Set-Cookie': buildSessionCookie(user.id) }
  );
}

function handleLogout() {
  return json(200, { ok: true }, { 'Set-Cookie': buildExpiredSessionCookie() });
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
  const base = new Date(date.getFullYear(), date.getMonth(), 1);
  base.setHours(0, 0, 0, 0);
  return base;
}

function endOfMonth(date) {
  const base = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  base.setHours(0, 0, 0, 0);
  return base;
}

function toIso(date) {
  return new Date(date).toISOString();
}

function parseDateRange(query) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;

  if (to) {
    to.setUTCDate(to.getUTCDate() + 1);
  }

  return {
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
  };
}

function minutesBetween(entry, referenceNow = new Date()) {
  const start = new Date(entry.startAt).getTime();
  const end = new Date(entry.endAt || referenceNow).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function mapEntry(state, entry, referenceNow = new Date()) {
  const user = findUserById(state, entry.userId);
  const company = findCompanyById(state, entry.companyId);
  return {
    id: entry.id,
    userId: entry.userId,
    companyId: entry.companyId,
    userName: user ? user.name : null,
    companyName: company ? company.name : null,
    startAt: entry.startAt,
    endAt: entry.endAt || null,
    minutes: minutesBetween(entry, referenceNow),
  };
}

function listEntries(state, filters = {}, referenceNow = new Date()) {
  return state.entries
    .filter(entry => {
      if (filters.userId && entry.userId !== Number(filters.userId)) return false;
      if (filters.companyId && entry.companyId !== Number(filters.companyId)) return false;
      if (filters.from && entry.startAt < filters.from) return false;
      if (filters.to && entry.startAt >= filters.to) return false;
      return true;
    })
    .slice()
    .sort((left, right) => new Date(right.startAt) - new Date(left.startAt))
    .map(entry => mapEntry(state, entry, referenceNow));
}

function getActiveEntryForUser(state, userId, referenceNow = new Date()) {
  const entry = state.entries
    .filter(item => item.userId === Number(userId) && !item.endAt)
    .slice()
    .sort((left, right) => new Date(right.startAt) - new Date(left.startAt))[0];

  return entry ? mapEntry(state, entry, referenceNow) : null;
}

function summarizeEntries(entries) {
  const totalsByUser = new Map();
  const totalsByCompany = new Map();
  const totalsByDay = new Map();

  entries.forEach(entry => {
    totalsByUser.set(entry.userName, (totalsByUser.get(entry.userName) || 0) + entry.minutes);
    totalsByCompany.set(entry.companyName, (totalsByCompany.get(entry.companyName) || 0) + entry.minutes);
    totalsByDay.set(entry.startAt.slice(0, 10), (totalsByDay.get(entry.startAt.slice(0, 10)) || 0) + entry.minutes);
  });

  return {
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    entriesCount: entries.length,
    byUser: mapTotals(totalsByUser),
    byCompany: mapTotals(totalsByCompany),
    byDay: mapTotals(totalsByDay),
  };
}

function mapTotals(map) {
  return [...map.entries()]
    .map(([label, minutes]) => ({ label, minutes }))
    .sort((left, right) => right.minutes - left.minutes || String(left.label).localeCompare(String(right.label)));
}

function buildDashboard(state, currentUser) {
  const now = new Date();
  const weekFrom = toIso(startOfWeek(now));
  const weekTo = toIso(endOfWeek(now));
  const monthFrom = toIso(startOfMonth(now));
  const monthTo = toIso(endOfMonth(now));

  const weekEntries = listEntries(state, { from: weekFrom, to: weekTo }, now);
  const monthEntries = listEntries(state, { from: monthFrom, to: monthTo }, now);
  const userWeekEntries = weekEntries.filter(entry => entry.userId === currentUser.id);
  const userMonthEntries = monthEntries.filter(entry => entry.userId === currentUser.id);

  return {
    user: currentUser,
    activeEntry: getActiveEntryForUser(state, currentUser.id, now),
    userWeekMinutes: userWeekEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    userMonthMinutes: userMonthEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    recentEntries: listEntries(state, { userId: currentUser.id }, now).slice(0, 10),
    totals: {
      teamWeekMinutes: weekEntries.reduce((sum, entry) => sum + entry.minutes, 0),
      teamMonthMinutes: monthEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    },
    ranking: listUsers(state)
      .map(user => ({
        id: user.id,
        name: user.name,
        role: user.role,
        weekMinutes: weekEntries.filter(entry => entry.userId === user.id).reduce((sum, entry) => sum + entry.minutes, 0),
        monthMinutes: monthEntries.filter(entry => entry.userId === user.id).reduce((sum, entry) => sum + entry.minutes, 0),
        activeEntry: getActiveEntryForUser(state, user.id, now),
      }))
      .sort((left, right) => right.weekMinutes - left.weekMinutes || right.monthMinutes - left.monthMinutes),
    companyStats: listCompanies(state).map(company => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      weekMinutes: weekEntries.filter(entry => entry.companyId === company.id).reduce((sum, entry) => sum + entry.minutes, 0),
      monthMinutes: monthEntries.filter(entry => entry.companyId === company.id).reduce((sum, entry) => sum + entry.minutes, 0),
    })),
  };
}

function handleDashboard(state, user) {
  return json(200, buildDashboard(state, user));
}

async function handleTimerStart(req, user) {
  const body = await parseJsonBody(req);
  const companyId = Number(body.companyId);

  const result = await updateState(draft => {
    const company = findCompanyById(draft, companyId);
    if (!company) {
      const error = new Error('Empresa invalida.');
      error.statusCode = 400;
      throw error;
    }
    if (draft.entries.some(entry => entry.userId === user.id && !entry.endAt)) {
      const error = new Error('Ja existe um relogio em andamento para este usuario.');
      error.statusCode = 409;
      throw error;
    }

    const entry = {
      id: draft.nextIds.entry,
      userId: user.id,
      companyId,
      startAt: new Date().toISOString(),
      endAt: null,
      createdAt: new Date().toISOString(),
    };

    draft.nextIds.entry += 1;
    draft.entries.push(entry);
    return entry.id;
  });

  const entry = mapEntry(result.state, result.state.entries.find(item => item.id === result.result));
  return json(201, { entry });
}

async function handleTimerStop(user) {
  const result = await updateState(draft => {
    const activeEntry = draft.entries
      .filter(entry => entry.userId === user.id && !entry.endAt)
      .slice()
      .sort((left, right) => new Date(right.startAt) - new Date(left.startAt))[0];

    if (!activeEntry) {
      const error = new Error('Nenhum relogio ativo para encerrar.');
      error.statusCode = 409;
      throw error;
    }

    activeEntry.endAt = new Date().toISOString();
    return activeEntry.id;
  });

  const entry = mapEntry(result.state, result.state.entries.find(item => item.id === result.result));
  return json(200, { entry });
}

function handleReports(req, state) {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams);
  const range = parseDateRange(query);
  const filters = {
    from: range.from,
    to: range.to,
    userId: query.userId ? Number(query.userId) : null,
    companyId: query.companyId ? Number(query.companyId) : null,
  };
  const entries = listEntries(state, filters, new Date());
  return json(200, {
    filters,
    summary: summarizeEntries(entries),
    entries,
  });
}

function handleReportExport(req, state) {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams);
  const range = parseDateRange(query);
  const filters = {
    from: range.from,
    to: range.to,
    userId: query.userId ? Number(query.userId) : null,
    companyId: query.companyId ? Number(query.companyId) : null,
  };
  const entries = listEntries(state, filters, new Date());
  const lines = [
    ['id', 'colaborador', 'empresa', 'inicio', 'fim', 'minutos'],
    ...entries.map(entry => [
      entry.id,
      entry.userName,
      entry.companyName,
      entry.startAt,
      entry.endAt || '',
      entry.minutes,
    ]),
  ];
  const csv = lines.map(line => line.map(csvEscape).join(',')).join('\n');

  return text(200, csv, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="relatorio-horas.csv"',
  });
}

async function handleDeleteEntry(route, state, user) {
  const entryId = Number(route.split('/').pop());
  const existing = state.entries.find(entry => entry.id === entryId);

  if (!existing) {
    return json(404, { error: 'Registro nao encontrado.' });
  }
  if (existing.userId !== user.id && user.role !== 'admin') {
    return json(403, { error: 'Sem permissao para excluir este registro.' });
  }
  if (!existing.endAt) {
    return json(409, { error: 'Nao e possivel excluir um relogio ativo.' });
  }

  await updateState(draft => {
    draft.entries = draft.entries.filter(entry => entry.id !== entryId);
  });

  return json(200, { ok: true });
}

function csvEscape(value) {
  const textValue = String(value ?? '');
  if (textValue.includes(',') || textValue.includes('"') || textValue.includes('\n')) {
    return `"${textValue.replace(/"/g, '""')}"`;
  }
  return textValue;
}

