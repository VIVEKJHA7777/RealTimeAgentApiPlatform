import { Prisma } from '../generated/prisma/client.js';

// Prisma error codes we care about. Full list: https://pris.ly/d/prisma-error-codes
//   P2002 = unique constraint violated (e.g. email already exists)
//   P2003 = foreign key rule broken (e.g. deleting a row that others still point to)
//   P2025 = record to update/delete was not found

// Name of the violated unique constraint, e.g. "users_email_key".
// With the pg driver adapter (Prisma 7) it lives in meta.driverAdapterError.cause.constraint.index.
function uniqueConstraintName(err: Prisma.PrismaClientKnownRequestError): string | undefined {
  const cause = (err.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } })
    ?.cause;
  return cause?.constraint?.index;
}

// True when `err` is a unique-constraint violation.
// Pass a constraint name to check for one specific rule (e.g. 'users_email_key').
//
// This is how we handle races: two requests may both pass our "is it free?" check,
// but the database lets only one insert win. The loser lands here.
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  return constraint === undefined || uniqueConstraintName(err) === constraint;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

// True when a foreign key blocked the write, e.g. deleting a data source an API still uses.
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}
