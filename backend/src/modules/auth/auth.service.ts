// SERVICE layer: business rules + database. Knows nothing about HTTP (no req/res).
// Throws AppError for expected problems; lets unexpected errors bubble up untouched.
import argon2 from 'argon2';
import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import { signupAllowed } from '../../lib/signup-policy.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { generateSessionToken, hashSessionToken, newSessionExpiry } from '../../lib/session.js';
import type { LoginInput, SignupInput } from './auth.schemas.js';

// argon2id with OWASP's recommended minimum: 19 MiB memory, 2 passes, 1 thread.
// Each hash takes ~tens of ms and 19 MiB RAM. Lower than the library default (64 MiB)
// so that many sign-ups/logins at the same time don't use too much memory.
// The settings are stored inside each hash, so we can raise them later safely.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const; // `as const` keeps `type` as the exact value argon2 expects, not just "number"

// The only user fields we ever send to the browser. `passwordHash` is never selected.
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

// The TypeScript type of a user selected with publicUserSelect: { id, email, name, createdAt }.
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

// Creates a session row and returns the raw token for the cookie.
// Only the token's hash is stored (see lib/session.ts).
async function createSession(userId: string) {
  const token = generateSessionToken();
  const expiresAt = newSessionExpiry();
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function signup(input: SignupInput) {
  // 6.0: on a public server only allowed emails may sign up (SIGNUP_ALLOWED_EMAILS).
  if (!signupAllowed(input.email, env.SIGNUP_ALLOWED_EMAILS, env.NODE_ENV === 'production')) {
    throw new AppError(403, 'SIGNUP_CLOSED', "Sign-up is closed on this server for this email. Ask the server's owner to add it.");
  }
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  const token = generateSessionToken();
  const expiresAt = newSessionExpiry();

  try {
    // ONE statement creates the user AND their first session (a "nested write").
    // It's atomic: either both rows are saved or neither, so we never end up with a
    // user that has no session or a session without a user.
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        sessions: { create: { tokenHash: hashSessionToken(token), expiresAt } },
      },
      select: publicUserSelect,
    });
    return { user, token, expiresAt };
  } catch (err) {
    // No "does this email exist?" check before the insert: it would race anyway.
    // The unique index decides; the loser of a race (or a plain duplicate) lands here.
    if (isUniqueViolation(err, 'users_email_key')) {
      // Friendly error for the caller; the original DB error is kept as `cause` for the logs.
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists', {
        cause: err,
      });
    }
    // Anything else (DB down, bug...) is not ours to handle here: pass it up unchanged.
    throw err;
  }
}

// A real argon2 hash of a throw-away password, made once when the server starts.
// Used when the email doesn't exist, so that "unknown email" takes as long as
// "wrong password". Otherwise an attacker could time responses to find which emails exist.
const dummyPasswordHash = argon2.hash('timing-equaliser-not-a-real-password', ARGON2_OPTIONS);

// One message for both "no such email" and "wrong password" (decision P1-8).
const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true },
  });

  if (!user) {
    await argon2.verify(await dummyPasswordHash, input.password); // same work, result ignored
    throw invalidCredentials();
  }

  // argon2.verify reads the salt and settings from the stored hash itself.
  const passwordOk = await argon2.verify(user.passwordHash, input.password);
  if (!passwordOk) {
    throw invalidCredentials();
  }

  // Each login creates a NEW session (laptop and phone can be logged in at the same time).
  const { token, expiresAt } = await createSession(user.id);
  const { passwordHash: _ignored, ...publicUser } = user; // never return the hash
  return { user: publicUser, token, expiresAt };
}

// Deletes one session (= logs out one browser; other browsers stay logged in).
// deleteMany instead of delete: if the row is already gone (two tabs logging out at the
// same moment, or it just expired) this is not an error. Logging out is "idempotent".
export async function logout(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

// Cookie token → { sessionId, user }, or null if the token is unknown or expired.
// Called on every request that carries a session cookie (middleware/load-session.ts).
export async function findSessionByToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true, expiresAt: true, user: { select: publicUserSelect } },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    // Expired: tidy it up now. deleteMany = no error if another request already deleted it.
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return { sessionId: session.id, user: session.user };
}
