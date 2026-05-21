import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { Redis } from '@upstash/redis';

function getRedis() {
  return Redis.fromEnv();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILE_DIR = path.join(__dirname, '..', '..', 'data');
const FILE_PATH = path.join(FILE_DIR, 'store.json');
const STORE_KEY = 'team-hours-state';
const SCHEMA_VERSION = 2;

const SEED_USERS = [
  { id: 1, name: 'Bia',         login: 'bia',        password: '1234', role: 'admin' },
  { id: 2, name: 'Zion',        login: 'zion',       password: '1234', role: 'user' },
  { id: 3, name: 'Maria Clara', login: 'mariaclara', password: '1234', role: 'admin' },
  { id: 4, name: 'Malu',        login: 'malu',       password: '1234', role: 'user' },
  { id: 5, name: 'Thiago',      login: 'thiago',     password: '1234', role: 'user' },
  { id: 6, name: 'Samuel',      login: 'samuel',     password: '1234', role: 'user' },
  { id: 7, name: 'Klenio',      login: 'klenio',     password: '1234', role: 'user' },
];

const SEED_COMPANIES = [
  { id: 1, name: 'Carbone', slug: 'carbone' },
  { id: 2, name: 'Seubone', slug: 'seubone' },
  { id: 3, name: 'Onevo',   slug: 'onevo' },
];

function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    nextIds: { user: 8, company: 4, entry: 1 },
    users: SEED_USERS.map(user => ({
      id: user.id,
      name: user.name,
      login: user.login,
      passwordHash: bcrypt.hashSync(user.password, 10),
      role: user.role,
      createdAt: new Date().toISOString(),
    })),
    companies: SEED_COMPANIES.map(company => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      createdAt: new Date().toISOString(),
    })),
    entries: [],
  };
}

function isVercelRuntime() {
  return !!process.env.UPSTASH_REDIS_REST_URL || !!process.env.VERCEL;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashState(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function ensureLocalDir() {
  if (!fs.existsSync(FILE_DIR)) {
    fs.mkdirSync(FILE_DIR, { recursive: true });
  }
}

function applyMigrations(state) {
  const seedLogins = new Set(SEED_USERS.map(u => u.login));
  const hasNewUsers = Array.isArray(state.users) && state.users.some(u => seedLogins.has(u.login));
  const versionOk = (state.schemaVersion || 1) >= SCHEMA_VERSION;

  if (hasNewUsers && versionOk) return false;

  const fresh = createInitialState();
  state.users = fresh.users;
  state.nextIds.user = fresh.nextIds.user;
  state.schemaVersion = SCHEMA_VERSION;
  return true;
}

async function readStateWithMeta() {
  if (isVercelRuntime()) {
    const redis = getRedis();
    let state = await redis.get(STORE_KEY);

    if (!state) {
      const initialState = createInitialState();
      // SET NX: only set if key does not exist; returns 'OK' if set, null if already exists
      const result = await redis.set(STORE_KEY, JSON.stringify(initialState), { nx: true });
      if (result === null) {
        state = await redis.get(STORE_KEY);
        state = typeof state === 'string' ? JSON.parse(state) : state;
      } else {
        return { state: initialState, etag: null };
      }
    } else if (typeof state === 'string') {
      state = JSON.parse(state);
    }

    if (applyMigrations(state)) {
      await redis.set(STORE_KEY, JSON.stringify(state));
      return { state, etag: null };
    }

    return { state, etag: null };
  }

  // Local filesystem fallback
  ensureLocalDir();
  if (!fs.existsSync(FILE_PATH)) {
    const initialState = createInitialState();
    fs.writeFileSync(FILE_PATH, JSON.stringify(initialState, null, 2));
    return { state: initialState, etag: hashState(initialState) };
  }

  const state = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  if (applyMigrations(state)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(state, null, 2));
    return { state, etag: hashState(state) };
  }
  return { state, etag: hashState(state) };
}

async function writeState(nextState, expectedEtag) {
  if (isVercelRuntime()) {
    const redis = getRedis();
    await redis.set(STORE_KEY, JSON.stringify(nextState));
    return null;
  }

  // Local filesystem fallback with optimistic locking
  ensureLocalDir();
  if (expectedEtag && fs.existsSync(FILE_PATH)) {
    const current = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    if (hashState(current) !== expectedEtag) {
      const error = new Error('State conflict');
      error.code = 'STATE_CONFLICT';
      throw error;
    }
  }

  fs.writeFileSync(FILE_PATH, JSON.stringify(nextState, null, 2));
  return hashState(nextState);
}

async function updateState(mutator, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const { state, etag } = await readStateWithMeta();
    const draft = clone(state);
    const result = await mutator(draft);

    try {
      const nextEtag = await writeState(draft, etag);
      return { state: draft, etag: nextEtag, result };
    } catch (error) {
      if (error.code === 'STATE_CONFLICT' && attempt < retries - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Falha ao atualizar o armazenamento compartilhado.');
}

async function resetToSeed() {
  const freshState = createInitialState();
  if (isVercelRuntime()) {
    const redis = getRedis();
    await redis.set(STORE_KEY, JSON.stringify(freshState));
  } else {
    ensureLocalDir();
    fs.writeFileSync(FILE_PATH, JSON.stringify(freshState, null, 2));
  }
}

export { readStateWithMeta, updateState, resetToSeed };
