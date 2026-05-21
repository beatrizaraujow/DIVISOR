import bcrypt from 'bcryptjs';
import { buildSessionCookie, buildExpiredSessionCookie, getUserIdFromRequest } from './lib/auth.mjs';
import { readStateWithMeta, updateState, resetToSeed } from './lib/store.mjs';

// ─── Vercel Node.js entry point ───────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const webReq = await toWebRequest(req);
    const webRes = await dispatch(webReq);
    await writeWebResponse(res, webRes);
  } catch (error) {
    res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || 'Erro interno do servidor.' }));
  }
}

async function toWebRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const fullUrl = `${protocol}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val !== undefined) {
      Array.isArray(val) ? val.forEach(v => headers.append(key, v)) : headers.set(key, val);
    }
  }

  return new Request(fullUrl, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? null : rawBody,
  });
}

async function writeWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  for (const [key, val] of webRes.headers.entries()) res.setHeader(key, val);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function dispatch(req) {
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
      return requireAuth(req, stateMeta.state, () => handleLogout());
    }
    if (method === 'GET' && route === '/dashboard') {
      return requireAuth(req, stateMeta.state, user => handleDashboard(stateMeta.state, user));
    }
    if (method === 'POST' && route === '/timer-start') {
      return await requireAuth(req, stateMeta.state, user => handleTimerStart(req, user));
    }
    if (method === 'POST' && route === '/timer-stop') {
      return await requireAuth(req, stateMeta.state, user => handleTimerStop(user));
    }
    if (method === 'GET' && route === '/reports') {
      return requireAuth(req, stateMeta.state, user => handleReports(req, stateMeta.state, user));
    }
    if (method === 'GET' && route === '/reports-export') {
      return requireAuth(req, stateMeta.state, user => handleReportExport(req, stateMeta.state, user));
    }
    if (method === 'DELETE' && route === '/entry') {
      return await requireAuth(req, stateMeta.state, user => handleDeleteEntry(url, stateMeta.state, user));
    }
    if (method === 'POST' && route === '/password') {
      return await handleChangePassword(req, stateMeta.state);
    }
    if (method === 'POST' && route === '/reset') {
      return await requireAuth(req, stateMeta.state, user => handleReset(user));
    }
    if (method === 'GET' && route === '/admin-reset') {
      return await handlePublicReset(req);
    }

    return json(404, { error: 'Rota nao encontrada.' });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || 'Erro interno do servidor.' });
  }
}

function normalizePath(pathname = '') {
  if (pathname.startsWith('/api')) {
    const rest = pathname.slice('/api'.length);
    return rest || '/';
  }
  return pathname || '/';
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

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

// ─── Domain helpers ───────────────────────────────────────────────────────────

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, login: user.login, role: user.role };
}

function listUsers(state) {
  return state.users
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(publicUser);
}

function listCompanies(state) {
  return state.companies
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({ id: c.id, name: c.name, slug: c.slug }));
}

function findUserById(state, userId) {
  return state.users.find(u => u.id === Number(userId)) || null;
}

function findUserByLogin(state, login) {
  return state.users.find(u => u.login === login) || null;
}

function findCompanyById(state, companyId) {
  return state.companies.find(c => c.id === Number(companyId)) || null;
}

function requireAuth(req, state, callback) {
  const userId = getUserIdFromRequest(req);
  const user = userId ? findUserById(state, userId) : null;
  if (!user) return json(401, { error: 'Nao autenticado.' });
  return callback(publicUser(user));
}

// ─── Route handlers ───────────────────────────────────────────────────────────

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
    { user: publicUser(user), companies: listCompanies(state), users: listUsers(state) },
    { 'Set-Cookie': buildSessionCookie(user.id) }
  );
}

function handleLogout() {
  return json(200, { ok: true }, { 'Set-Cookie': buildExpiredSessionCookie() });
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

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
  if (to) to.setUTCDate(to.getUTCDate() + 1);
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
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))
    .map(entry => mapEntry(state, entry, referenceNow));
}

function getActiveEntryForUser(state, userId, referenceNow = new Date()) {
  const entry = state.entries
    .filter(e => e.userId === Number(userId) && !e.endAt)
    .slice()
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))[0];
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
    totalMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
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

function buildDashboard(state, currentUser) {
  const now = new Date();
  const weekFrom = toIso(startOfWeek(now));
  const weekTo = toIso(endOfWeek(now));
  const monthFrom = toIso(startOfMonth(now));
  const monthTo = toIso(endOfMonth(now));

  const weekEntries = listEntries(state, { from: weekFrom, to: weekTo }, now);
  const monthEntries = listEntries(state, { from: monthFrom, to: monthTo }, now);
  const userWeekEntries = weekEntries.filter(e => e.userId === currentUser.id);
  const userMonthEntries = monthEntries.filter(e => e.userId === currentUser.id);

  return {
    user: currentUser,
    activeEntry: getActiveEntryForUser(state, currentUser.id, now),
    userWeekMinutes: userWeekEntries.reduce((sum, e) => sum + e.minutes, 0),
    userMonthMinutes: userMonthEntries.reduce((sum, e) => sum + e.minutes, 0),
    recentEntries: listEntries(state, { userId: currentUser.id }, now).slice(0, 10),
    totals: {
      teamWeekMinutes: weekEntries.reduce((sum, e) => sum + e.minutes, 0),
      teamMonthMinutes: monthEntries.reduce((sum, e) => sum + e.minutes, 0),
    },
    ranking: listUsers(state)
      .map(user => ({
        id: user.id,
        name: user.name,
        role: user.role,
        weekMinutes: weekEntries.filter(e => e.userId === user.id).reduce((sum, e) => sum + e.minutes, 0),
        monthMinutes: monthEntries.filter(e => e.userId === user.id).reduce((sum, e) => sum + e.minutes, 0),
        activeEntry: getActiveEntryForUser(state, user.id, now),
      }))
      .sort((a, b) => b.weekMinutes - a.weekMinutes || b.monthMinutes - a.monthMinutes),
    companyStats: listCompanies(state).map(company => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      weekMinutes: weekEntries.filter(e => e.companyId === company.id).reduce((sum, e) => sum + e.minutes, 0),
      monthMinutes: monthEntries.filter(e => e.companyId === company.id).reduce((sum, e) => sum + e.minutes, 0),
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
    if (draft.entries.some(e => e.userId === user.id && !e.endAt)) {
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

  const entry = mapEntry(result.state, result.state.entries.find(e => e.id === result.result));
  return json(201, { entry });
}

async function handleTimerStop(user) {
  const result = await updateState(draft => {
    const activeEntry = draft.entries
      .filter(e => e.userId === user.id && !e.endAt)
      .slice()
      .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))[0];

    if (!activeEntry) {
      const error = new Error('Nenhum relogio ativo para encerrar.');
      error.statusCode = 409;
      throw error;
    }
    activeEntry.endAt = new Date().toISOString();
    return activeEntry.id;
  });

  const entry = mapEntry(result.state, result.state.entries.find(e => e.id === result.result));
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
  return json(200, { filters, summary: summarizeEntries(entries), entries });
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
    ...entries.map(e => [e.id, e.userName, e.companyName, e.startAt, e.endAt || '', e.minutes]),
  ];
  const csv = lines.map(line => line.map(csvEscape).join(',')).join('\n');
  return text(200, csv, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="relatorio-horas.csv"',
  });
}

async function handleDeleteEntry(url, state, user) {
  const entryId = Number(url.searchParams.get('id'));
  const existing = state.entries.find(e => e.id === entryId);

  if (!existing) return json(404, { error: 'Registro nao encontrado.' });
  if (existing.userId !== user.id && user.role !== 'admin') {
    return json(403, { error: 'Sem permissao para excluir este registro.' });
  }
  if (!existing.endAt) return json(409, { error: 'Nao e possivel excluir um relogio ativo.' });

  await updateState(draft => {
    draft.entries = draft.entries.filter(e => e.id !== entryId);
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

async function handleChangePassword(req, state) {
  const { login, currentPassword, newPassword } = await parseJsonBody(req);
  if (!login || !currentPassword || !newPassword) {
    return json(400, { error: 'Dados incompletos.' });
  }
  if (newPassword.length < 4) {
    return json(400, { error: 'A nova senha deve ter ao menos 4 caracteres.' });
  }
  const user = findUserByLogin(state, login);
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return json(401, { error: 'Login ou senha atual incorretos.' });
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  await updateState(draft => {
    const u = draft.users.find(item => item.login === login);
    if (u) u.passwordHash = newHash;
  });
  return json(200, { ok: true });
}

async function handleReset(user) {
  if (user.role !== 'admin') {
    return json(403, { error: 'Apenas administradores podem resetar o banco de dados.' });
  }
  await resetToSeed();
  return json(200, { ok: true, message: 'Banco de dados resetado com os usuarios iniciais.' });
}

async function handlePublicReset(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (token !== 'mktime-reset-2026') {
    return json(403, { error: 'Token invalido.' });
  }
  await resetToSeed();
  return new Response(
    '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#222;color:#FCC100;padding:40px">' +
    '<h2>&#10003; Banco de dados resetado!</h2>' +
    '<p style="color:#fff">Agora acesse <a href="/" style="color:#FCC100">a aplicacao</a> e faca login com os novos usuarios.</p>' +
    '<ul style="color:#fff"><li>bia / 1234 (admin)</li><li>zion / 1234</li><li>mariaclara / 1234</li>' +
    '<li>malu / 1234</li><li>thiago / 1234</li><li>samuel / 1234</li><li>klenio / 1234</li></ul>' +
    '</body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
