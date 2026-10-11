// SERVICE layer for brands (organizations): business rules + database. No req/res here.
import { randomInt } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import type { CreateOrganizationInput } from './organizations.schemas.js';

// The only brand fields we send to the browser.
export const publicOrganizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
} satisfies Prisma.OrganizationSelect;

export type PublicOrganization = Prisma.OrganizationGetPayload<{
  select: typeof publicOrganizationSelect;
}>;

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 6; // 36^6 ≈ 2.2 billion combinations per base
const MAX_SLUG_ATTEMPTS = 3;

// 6 random characters, e.g. "k3x9q2". crypto.randomInt = unpredictable (unlike Math.random).
function randomSlugSuffix(): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

// Creates a brand owned by `ownerId`. Final slug = "<base>-<6 random chars>".
//
// Concurrency: two users (or two clicks) with the same base get different suffixes, so both
// succeed. In the astronomically rare case that a generated slug is already taken, the
// UNIQUE index rejects it and we simply try a new suffix (up to 3 times).
export async function createOrganization(ownerId: string, input: CreateOrganizationInput) {
  for (let attempt = 1; ; attempt++) {
    const slug = `${input.slug}-${randomSlugSuffix()}`;
    try {
      return await prisma.organization.create({
        data: { ownerId, name: input.name, slug },
        select: publicOrganizationSelect,
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'organizations_slug_key')) throw err; // not ours: pass it up
      if (attempt === MAX_SLUG_ATTEMPTS) {
        throw new AppError(409, 'SLUG_TAKEN', 'Could not create a unique slug, please try again', {
          cause: err,
        });
      }
      // else: loop and try another random suffix
    }
  }
}

// All brands owned by `ownerId`, newest first. `id` breaks ties for brands created in the
// same millisecond, so the order is always stable.
export async function listOrganizations(ownerId: string) {
  return prisma.organization.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: publicOrganizationSelect,
  });
}

// The brand with this slug, ONLY if `ownerId` owns it; otherwise null.
// One query with both conditions: "someone else's" and "doesn't exist" look the same.
export async function findOwnedOrganization(ownerId: string, slug: string) {
  return prisma.organization.findFirst({
    where: { slug, ownerId },
    select: publicOrganizationSelect,
  });
}
