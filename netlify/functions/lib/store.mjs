import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getStore } from '@netlify/blobs';

const FILE_DIR = path.join(__dirname, '..', '..', '..', 'data');
const FILE_PATH = path.join(FILE_DIR, 'netlify-store.json');
const STORE_NAME = 'team-hours';
const STORE_KEY = 'state';

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
  { id: 3, name: 'Onevo', slug: 'onevo' },
];

function createInitialState() {
  return {
    nextIds: {
      user: 8,
      company: 4,
      entry: 1,
    },
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

function isNetlifyRuntime() {
  return !!process.env.NETLIFY_BLOBS_CONTEXT || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function getNetlifyStore(netlifyContext) {
  const opts = { name: STORE_NAME, consistency: 'strong' };
  if (netlifyContext) opts.netlifyContext = netlifyContext;
  return getStore(opts);
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

async function readStateWithMeta(netlifyContext = null) {
  if (isNetlifyRuntime()) {
    const store = getNetlifyStore(netlifyContext);
    let entry = await store.getWithMetadata(STORE_KEY, { type: 'json' });
    if (!entry) {
      const initialState = createInitialState();
      const created = await store.setJSON(STORE_KEY, initialState, { onlyIfNew: true });
      if (!created.modified) {
        entry = await store.getWithMetadata(STORE_KEY, { type: 'json' });
      } else {
        return { state: initialState, etag: created.etag || null };
      }
    }

    return { state: entry.data, etag: entry.etag };
  }

  ensureLocalDir();
  if (!fs.existsSync(FILE_PATH)) {
    const initialState = createInitialState();
    fs.writeFileSync(FILE_PATH, JSON.stringify(initialState, null, 2));
    return { state: initialState, etag: hashState(initialState) };
  }

  const state = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  return { state, etag: hashState(state) };
}

async function writeState(nextState, expectedEtag, netlifyContext = null) {
  if (isNetlifyRuntime()) {
    const store = getNetlifyStore(netlifyContext);
    const result = expectedEtag
      ? await store.setJSON(STORE_KEY, nextState, { onlyIfMatch: expectedEtag })
      : await store.setJSON(STORE_KEY, nextState, { onlyIfNew: true });

    if (!result.modified) {
      const error = new Error('State conflict');
      error.code = 'STATE_CONFLICT';
      throw error;
    }

    return result.etag || null;
  }

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

async function updateState(mutator, retries = 4, netlifyContext = null) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const { state, etag } = await readStateWithMeta(netlifyContext);
    const draft = clone(state);
    const result = await mutator(draft);

    try {
      const nextEtag = await writeState(draft, etag, netlifyContext);
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

async function resetToSeed(netlifyContext = null) {
  const freshState = createInitialState();
  if (isNetlifyRuntime()) {
    const store = getNetlifyStore(netlifyContext);
    await store.setJSON(STORE_KEY, freshState);
  } else {
    ensureLocalDir();
    fs.writeFileSync(FILE_PATH, JSON.stringify(freshState, null, 2));
  }
}

export { readStateWithMeta, updateState, resetToSeed };