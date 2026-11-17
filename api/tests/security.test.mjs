import assert from "node:assert/strict";
import test from "node:test";
import { BusyError, cookie, createHashGate, createToken, hashPassword, hashToken, normalizeEmail, readCookie, safeEqual, validatePassword, verifyPassword } from "../src/security.mjs";

test("email normalization trims and normalizes internationalized domains", () => {
  assert.equal(normalizeEmail("  User+tag@bücher.de  "), "user+tag@xn--bcher-kva.de");
  assert.equal(normalizeEmail("not an email"), null);
  assert.equal(normalizeEmail("user..name@example.com"), null);
});

test("password policy allows long passphrases and preserves significant spaces", () => {
  assert.equal(validatePassword("long enough secure password"), null);
  assert.equal(validatePassword("short"), "Use at least 15 characters for your password.");
  assert.equal(validatePassword("               "), null);
  assert.equal(validatePassword("a".repeat(129)), "Password is too long.");
});

test("tokens are opaque, unique, and compared without accepting different values", () => {
  const a = createToken();
  const b = createToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(hashToken(a).length, 64);
  assert.equal(safeEqual(a, a), true);
  assert.equal(safeEqual(a, b), false);
});

test("cookies use matching path and secure attributes", () => {
  const value = cookie("__Host-stockroom_session", "abc", { secure: true, httpOnly: true, maxAge: 60 });
  assert.match(value, /Path=\//);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.equal(readCookie("a=1; stockroom_csrf=xyz", "stockroom_csrf"), "xyz");
});

test("scrypt passwords verify only against the matching password", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
  assert.equal(await verifyPassword("x", "malformed"), false);
});

test("hash gate rejects excess concurrent expensive work", async () => {
  const gate = createHashGate(1);
  let release;
  const first = gate(() => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(gate(async () => {}), BusyError);
  release();
  await first;
  assert.equal(await gate(async () => "ok"), "ok");
});
