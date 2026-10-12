// Test switches of an API (Phase 7, task 7.4): on / change / off, ending by themselves, and the audit.
// /v1 reads them itself (v1.service.ts, in the token query); what each does: v1/test-switches.ts.
//
//   - one row per API per kind (api_test_switches, unique); the owner sets options, scope (the whole
//     API or one token = one agent, P7-1), how long (≤ 24 h, P7-2) and "apply to our own checks" (P7-3)
//   - every change writes a line in the API's call log (kind "switch"): on / changed / off / ended,
//     with what, scope, until when and by whom. Same transaction as the change.
//   - expired switches are ignored by /v1 at once; the sweeper (every 30 s, and before each list /
//     change of that API) deletes them and writes "ended". DELETE … RETURNING: two server processes
//     can't both write "ended" for the same switch.
// Changes hold the API row lock (same order as tokens / design), so a switch can't aim at a token
// being revoked or renewed at that moment.
import type { Api, ApiTestSwitch, Prisma } from '../../../generated/prisma/client.js';
import { AppError, type ErrorDetail } from '../../../lib/app-error.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import type { StoredDesign } from '../design/design.schemas.js';
import { withApiLock } from '../tokens/tokens.service.js';
import { trimCallLogs } from '../../v1/call-log-store.js';
import { SWITCH_CATALOGUE, type SwitchKind } from '../../v1/test-switches.js';
import { noOptions, optionsFor, type SetSwitchInput } from './switches.schemas.js';

type Tx = Prisma.TransactionClient;
type Action = 'on' | 'changed' | 'off' | 'ended';
const SWEEP_EVERY_MS = 30_000;

const invalid = (message: string, details: ErrorDetail[] = []) => new AppError(400, 'SWITCH_INVALID', message, { details });

// The options a kind takes, checked; wrong_type's field must be one of the design's response keys.
function checkOptions(kind: SwitchKind, options: Record<string, unknown>, design: StoredDesign | null) {
  const schema = kind in optionsFor ? optionsFor[kind as keyof typeof optionsFor] : noOptions;
  const parsed = schema.safeParse(options);
  if (!parsed.success) {
    throw invalid('These options are not valid for this switch', parsed.error.issues.map((i) => ({ field: ['options', ...i.path].join('.'), message: i.message })));
  }
  if (kind === 'wrong_type') {
    const keys = (design?.fields ?? []).map((f) => f.responseKey);
    const field = (parsed.data as unknown as { field: string }).field;
    if (!keys.includes(field)) {
      throw invalid(keys.length > 0 ? `"${field}" is not a field of this API's answer. Choose one of: ${keys.join(', ')}` : 'This API has no fields yet: design it first', [
        { field: 'options.field', message: 'Not a response key of this API' },
      ]);
    }
  }
  return parsed.data as Record<string, unknown>;
}

// The audit line (one row of the call log, kind "switch").
async function audit(tx: Tx, api: Api, action: Action, row: ApiTestSwitch, by: string | null, at = new Date()) {
  const token = row.tokenId ? await tx.apiToken.findUnique({ where: { id: row.tokenId }, select: { name: true } }) : null;
  await tx.apiCallLog.create({
    data: {
      apiId: api.id,
      kind: 'switch',
      at,
      event: {
        action,
        switch: row.kind,
        options: row.options as Prisma.InputJsonValue,
        scope: row.tokenId ? { tokenId: row.tokenId, tokenName: token?.name ?? null } : null,
        applyToOwnChecks: row.applyToOwnChecks,
        endsAt: row.endsAt.toISOString(),
        by,
      },
    },
  });
}

// Ends this API's expired switches (or all APIs' when apiId is null), each with an "ended" line.
async function endExpired(tx: Tx, apiId: string | null) {
  const ended = await tx.$queryRaw<ApiTestSwitch[]>`
    DELETE FROM api_test_switches WHERE ends_at <= now() AND (${apiId}::text IS NULL OR api_id = ${apiId})
    RETURNING id, api_id AS "apiId", kind, options, token_id AS "tokenId", apply_to_own_checks AS "applyToOwnChecks",
              ends_at AS "endsAt", created_by_id AS "createdById", created_at AS "createdAt", updated_at AS "updatedAt"`;
  for (const row of ended) await audit(tx, { id: row.apiId } as Api, 'ended', row, null, row.endsAt);
  return ended;
}

export async function sweepExpiredSwitches() {
  const ended = await prisma.$transaction((tx) => endExpired(tx, null));
  for (const apiId of new Set(ended.map((r) => r.apiId))) await trimCallLogs(apiId);
  return ended.length;
}

let sweeper: NodeJS.Timeout | undefined;
export function startSwitchSweeper() {
  const run = () => sweepExpiredSwitches().catch((err: unknown) => logger.warn({ err }, 'Could not end expired test switches'));
  void run();
  sweeper = setInterval(run, SWEEP_EVERY_MS);
  sweeper.unref();
}
export const stopSwitchSweeper = () => clearInterval(sweeper);

// What the Test tab shows: the switches on now (scope with its token's name and agents) + the catalogue.
export async function listSwitches(api: Api) {
  await prisma.$transaction((tx) => endExpired(tx, api.id));
  const rows = await prisma.apiTestSwitch.findMany({
    where: { apiId: api.id },
    include: { token: { select: { id: true, name: true, hint: true, revokedAt: true, jivoxAgents: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }, createdBy: { select: { email: true } } },
  });
  const order = (kind: string) => SWITCH_CATALOGUE.findIndex((c) => c.kind === kind);
  return {
    switches: rows
      .sort((a, b) => order(a.kind) - order(b.kind))
      .map((r) => ({
        kind: r.kind as SwitchKind,
        options: r.options,
        scope: r.token
          ? { tokenId: r.token.id, tokenName: r.token.name, tokenHint: r.token.hint, revoked: r.token.revokedAt !== null, agents: r.token.jivoxAgents }
          : null,
        applyToOwnChecks: r.applyToOwnChecks,
        since: r.updatedAt,
        endsAt: r.endsAt,
        setBy: r.createdBy?.email ?? null,
      })),
    catalogue: SWITCH_CATALOGUE,
    now: new Date(), // the browser counts "ends in …" from the server's clock
  };
}

// PUT: on, or changed (options / scope / time / own checks). The time always counts from now.
export async function setSwitch(api: Api, kind: SwitchKind, input: SetSwitchInput, userId: string, email: string) {
  await withApiLock(api, async (tx) => {
    await endExpired(tx, api.id);
    const [fresh] = await tx.$queryRaw<{ design: StoredDesign | null }[]>`SELECT design FROM apis WHERE id = ${api.id}`;
    const options = checkOptions(kind, input.options, fresh.design);
    if (input.tokenId) {
      const token = await tx.apiToken.findFirst({ where: { id: input.tokenId, apiId: api.id } });
      if (!token) throw invalid('Not a token of this API', [{ field: 'tokenId', message: 'Choose one of this API\'s tokens (or none = every caller)' }]);
      if (token.revokedAt) throw invalid(`"${token.name}" is revoked: no call can use it`, [{ field: 'tokenId', message: 'Revoked' }]);
    }
    const before = await tx.apiTestSwitch.findUnique({ where: { apiId_kind: { apiId: api.id, kind } } });
    const now = new Date();
    const data = {
      options: options as Prisma.InputJsonValue,
      tokenId: input.tokenId,
      applyToOwnChecks: input.applyToOwnChecks,
      endsAt: new Date(now.getTime() + input.minutes * 60_000),
      createdById: userId,
    };
    const row = before
      ? await tx.apiTestSwitch.update({ where: { id: before.id }, data: { ...data, updatedAt: now } })
      : await tx.apiTestSwitch.create({ data: { apiId: api.id, kind, ...data, createdAt: now, updatedAt: now } });
    await audit(tx, api, before ? 'changed' : 'on', row, email, now);
  });
  await trimCallLogs(api.id);
  return listSwitches(api);
}

// DELETE one (kind) or all. Turning off a switch that isn't on is fine (same answer).
export async function turnOff(api: Api, kind: SwitchKind | null, email: string) {
  let off = 0;
  await withApiLock(api, async (tx) => {
    await endExpired(tx, api.id);
    const rows = await tx.apiTestSwitch.findMany({ where: { apiId: api.id, ...(kind && { kind }) } });
    await tx.apiTestSwitch.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    const now = new Date();
    for (const row of rows) await audit(tx, api, 'off', row, email, now);
    off = rows.length;
  });
  await trimCallLogs(api.id);
  return { ...(await listSwitches(api)), turnedOff: off };
}
