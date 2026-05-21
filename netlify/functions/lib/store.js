import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { getStore } from '@netlify/blobs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_DIR = path.join(__dirname, '..', '..', '..', 'data');
const FILE_PATH = path.join(FILE_DIR, 'netlify-store.json');
const STORE_NAME = 'team-hours';
const STORE_KEY = 'state';

const SEED_USERS = [
  { id: 1, name: 'Ana Beatriz', login: 'ana', password: '1234', role: 'admin' },
  { id: 2, name: 'Bruno Costa', login: 'bruno', password: '1234', role: 'member' },
  { id: 3, name: 'Carla Souza', login: 'carla', password: '1234', role: 'member' },
  { id: 4, name: 'Diego Lima', login: 'diego', password: '1234', role: 'member' },
  { id: 5, name: 'Elisa Rocha', login: 'elisa', password: '1234', role: 'member' },
  { id: 6, name: 'Felipe Nunes', login: 'felipe', password: '1234', role: 'member' },
  { id: 7, name: 'Giovana Alves', login: 'giovana', password: '1234', role: 'member' },
  { id: 8, name: 'Hugo Martins', login: 'hugo', password: '1234', role: 'member' },
];

const SEED_COMPANIES = [
  { id: 1, name: 'Carbone', slug: 'carbone' },
  { id: 2, name: 'Seubone', slug: 'seubone' },
  { id: 3, name: 'Onevo', slug: 'onevo' },
];

function createInitialState() {
  return {
    nextIds: {
      user: 9,
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
  return !!process.env.NETLIFY_BLOBS_CONTEXT;
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

async function readStateWithMeta() {
  if (isNetlifyRuntime()) {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
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

async function writeState(nextState, expectedEtag) {
  if (isNetlifyRuntime()) {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
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

export { readStateWithMeta, updateState };