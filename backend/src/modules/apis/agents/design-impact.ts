// What a design save does to the API's Jivox agents (task 5.6, P5-6). Pure:
// docs/test-scripts/phase-05-task-5.6-shape-lib.test.ts.
//
//   dropped: an agent field the OLD design served and the NEW one doesn't (removed, or its Jivox
//            field changed). The save asks first (409 AGENT_FIELDS_DROPPED) and goes ahead once the
//            user confirms exactly those (agent, field) pairs. A field that was already missing
//            before isn't asked about again.
//   changed: agents whose contract (its shape) is different after the save → "copy it again".
import type { StoredDesign } from '../design/design.schemas.js';
import { type ShapeContext, shapeFor } from './contract.js';
import { sameShape, shapeChanges } from './contract-shape.js';

export type ImpactAgent = { id: string; name: string; fields: string[]; agentInfo: unknown };
export type DroppedFields = { id: string; name: string; fields: string[]; left: number };

const served = (design: StoredDesign | null) => new Set((design?.fields ?? []).map((f) => f.jivoxColumn));

export function droppedAgentFields(before: StoredDesign | null, after: StoredDesign, agents: ImpactAgent[]): DroppedFields[] {
  const [had, has] = [served(before), served(after)];
  return agents.flatMap((a) => {
    const fields = a.fields.filter((f) => had.has(f) && !has.has(f));
    return fields.length > 0 ? [{ id: a.id, name: a.name, fields, left: a.fields.filter((f) => has.has(f)).length }] : [];
  });
}

const pairKey = (agentId: string, field: string) => `${agentId}\u0000${field}`;

// The dropped pairs the user hasn't confirmed (an agent added or changed since they were asked).
export function unconfirmed(dropped: DroppedFields[], confirmed: { agentId: string; field: string }[]) {
  const ok = new Set(confirmed.map((c) => pairKey(c.agentId, c.field)));
  return dropped.filter((d) => d.fields.some((f) => !ok.has(pairKey(d.id, f))));
}

// Agents whose contract is different after the save, with what changed.
export function changedContracts(before: ShapeContext | null, after: ShapeContext | null, agents: ImpactAgent[]) {
  if (!before || !after) return []; // first save: no contract existed before
  return agents.flatMap((a) => {
    const [was, now] = [shapeFor(before, a), shapeFor(after, a)];
    return sameShape(was, now) ? [] : [{ id: a.id, name: a.name, changes: shapeChanges(was, now) }];
  });
}
