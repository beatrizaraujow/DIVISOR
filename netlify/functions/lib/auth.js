const crypto = require('crypto');

const COOKIE_NAME = 'team_hours_session';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  return process.env.SESSION_SECRET || 'local-netlify-session-secret';
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function encodeSession(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + TWELVE_HOURS_MS });
  const encodedPayload = base64UrlEncode(payload);
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function decodeSession(token) {
  if (!token || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = signPayload(encodedPayload);

  if (!safeCompare(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload || typeof payload.userId !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(headerValue = '') {
  return headerValue.split(';').reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split('=');
    if (!name) return cookies;
    cookies[name] = rest.join('=');
    return cookies;
  }, {});
}

function getUserIdFromEvent(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const cookies = parseCookies(cookieHeader);
  const session = decodeSession(cookies[COOKIE_NAME]);
  return session ? session.userId : null;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

function isSecureRequest() {
  return process.env.URL ? process.env.URL.startsWith('https://') : false;
}

function buildSessionCookie(userId) {
  return serializeCookie(COOKIE_NAME, encodeSession(userId), {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(),
    maxAge: TWELVE_HOURS_MS / 1000,
  });
}

function buildExpiredSessionCookie() {
  return serializeCookie(COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(),
    expires: new Date(0),
    maxAge: 0,
  });
}

module.exports = {
  buildSessionCookie,
  buildExpiredSessionCookie,
  getUserIdFromEvent,
};