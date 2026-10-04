import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.ts";
import { BOT_ID, getOrCreatePet, type Pet } from "./pets.ts";

// One account per player ID, and the ID is also its pet's ID: one pet each.
// Passwords are scrypt-hashed with a per-account salt. A session is a random
// token in an HttpOnly cookie; only its SHA-256 is stored, so a leaked
// database doesn't hand out sessions.

export const PASSWORD = { min: 8, max: 128 };
export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_BYTES = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_BYTES);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Checked against when the ID has no account, so a wrong ID takes as long to
// refuse as a wrong password and doesn't reveal which IDs exist.
const decoy = hashPassword("not anyone's password");

const selectAccount = db.prepare("SELECT password_hash FROM accounts WHERE id = ?");
const insertAccount = db.prepare("INSERT INTO accounts (id, password_hash) VALUES (?, ?)");
const insertSession = db.prepare("INSERT INTO sessions (token_hash, player_id, expires_at) VALUES (?, ?, ?)");
const selectSession = db.prepare("SELECT player_id FROM sessions WHERE token_hash = ? AND expires_at > ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export const isValidPassword = (password: unknown): password is string =>
  typeof password === "string" && password.length >= PASSWORD.min && password.length <= PASSWORD.max;

export type AuthOutcome = { pet: Pet; created: boolean; token: string } | { status: 401 | 409; error: string };

function startSession(id: string): string {
  const token = randomBytes(32).toString("base64url");
  deleteExpired.run(Date.now());
  insertSession.run(tokenHash(token), id, Date.now() + SESSION_MS);
  return token;
}

export async function signUp(id: string, password: string): Promise<AuthOutcome> {
  if (id === BOT_ID) return { status: 409, error: "That ID belongs to the bot. Pick another." };
  if (selectAccount.get(id)) return { status: 409, error: "That ID is taken. Sign in, or pick another." };
  const hash = await hashPassword(password);
  // Someone may have taken the ID while the hash was being worked out.
  if (selectAccount.get(id)) return { status: 409, error: "That ID is taken. Sign in, or pick another." };
  // A pet from before accounts existed is claimed by whoever signs up first.
  const { pet, created } = getOrCreatePet(id);
  insertAccount.run(id, hash);
  return { pet, created, token: startSession(id) };
}

export async function signIn(id: string, password: string): Promise<AuthOutcome> {
  const account = selectAccount.get(id) as { password_hash: string } | undefined;
  const matches = await passwordMatches(password, account?.password_hash ?? (await decoy));
  if (!account || !matches) return { status: 401, error: "Wrong player ID or password." };
  return { pet: getOrCreatePet(id).pet, created: false, token: startSession(id) };
}

export function signOut(token: string): void {
  deleteSession.run(tokenHash(token));
}

// The player a request's session cookie signs in, if it's a live session.
export function sessionToken(cookieHeader: string | undefined): string | undefined {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

export function playerFor(cookieHeader: string | undefined): string | undefined {
  const token = sessionToken(cookieHeader);
  if (!token) return undefined;
  const row = selectSession.get(tokenHash(token), Date.now()) as { player_id: string } | undefined;
  return row?.player_id;
}

// Set-Cookie values to start and end a session. Secure in production, where
// the app is served over HTTPS; HttpOnly keeps it from scripts, and SameSite
// keeps other sites from acting with it.
const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`;
export const clearedCookie = (): string => `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
