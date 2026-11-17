import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { domainToASCII } from "node:url";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_BYTES = 32;

export class BusyError extends Error {}

export function createHashGate(maxConcurrent = 2) {
  let active = 0;
  return async (operation) => {
    if (active >= maxConcurrent) throw new BusyError("Password verification capacity reached");
    active += 1;
    try { return await operation(); }
    finally { active -= 1; }
  };
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || Buffer.byteLength(email) > 254 || /[\s\x00-\x1f\x7f]/u.test(email)) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at !== email.indexOf("@") || Buffer.byteLength(email.slice(0, at)) > 64) return null;
  const local = email.slice(0, at);
  const atom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
  const domain = domainToASCII(email.slice(at + 1));
  const labels = domain.split(".");
  if (!domain || domain.length > 253 || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || local.split(".").some((part) => !atom.test(part))) return null;
  return `${local}@${domain}`.toLowerCase();
}

export function validatePassword(value) {
  if (typeof value !== "string") return "Password is required.";
  const length = [...value].length;
  if (length < 15) return "Use at least 15 characters for your password.";
  if (length > 128 || Buffer.byteLength(value, "utf8") > 1024) return "Password is too long.";
  return null;
}

export function createToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function keyedHash(secret, value) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header, name) {
  if (typeof header !== "string") return null;
  for (const segment of header.split(";")) {
    const index = segment.indexOf("=");
    if (index < 1 || segment.slice(0, index).trim() !== name) continue;
    return segment.slice(index + 1).trim();
  }
  return null;
}

export function cookie(name, value, { secure, httpOnly = false, sameSite = "Lax", maxAge, clear = false } = {}) {
  return `${name}=${clear ? "" : value}; Path=/; SameSite=${sameSite}${httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}${maxAge === undefined ? "" : `; Max-Age=${clear ? 0 : maxAge}`}`;
}

export async function hashPassword(password, gate = async (run) => run()) {
  const salt = randomBytes(16);
  const derived = await gate(() => scryptAsync(Buffer.from(password, "utf8"), salt, KEY_BYTES, SCRYPT));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password, encoded, gate = async (run) => run()) {
  const match = typeof encoded === "string" && /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded);
  if (!match) return false;
  const [, n, r, p, saltText, expectedText] = match;
  if (Number(n) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(expectedText, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_BYTES) return false;
  const actual = await gate(() => scryptAsync(Buffer.from(password, "utf8"), salt, KEY_BYTES, SCRYPT));
  return timingSafeEqual(actual, expected);
}
