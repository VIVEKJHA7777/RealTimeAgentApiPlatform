// CONTROLLER for an API's design: HTTP in/out only.
import type { Request, Response } from 'express';
import { AppError } from '../../../lib/app-error.js';
import { validate } from '../../../lib/validate.js';
import { checkValuesSchema, previewSchema, saveDesignSchema } from './design.schemas.js';
import * as designService from './design.service.js';
import { previewDesign } from './preview.js';
import * as valueChecks from './value-checks.js';

// GET /api/organizations/:slug/apis/:apiSlug/design
// → 200 { design: { version, saved, idField, fields }, data: { idColumn, columns }, feedType,
//         problems, warnings }
export async function get(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store'); // changes on every save
  res.json(await designService.getDesign(req.api!));
}

// PUT /api/organizations/:slug/apis/:apiSlug/design   { version, idField, fields }
// → 200 (same shape as GET, version + 1, + agentImpact { dropped, changed }) · 400 DESIGN_INVALID
// · 409 DESIGN_CHANGED · 409 AGENT_FIELDS_DROPPED (extra.agents: who loses which fields; send them
//   back as confirmDroppedFields to save anyway)
export async function save(req: Request, res: Response) {
  // Shape problems and rule problems answer with the same code, so the Design tab handles
  // one kind of error (details[].field points at the input, e.g. "fields.2.responseKey").
  const parsed = saveDesignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'DESIGN_INVALID', 'The design has problems', {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    });
  }
  res.set('Cache-Control', 'no-store');
  res.json(await designService.saveDesign(req.api!, req.organization!.slug, parsed.data));
}

// GET /api/organizations/:slug/apis/:apiSlug/design/columns
// → 200 { sampledRows, columns: [{ name, isId, filled, empty, fits, candidates, suggestedType, examples }] }
// Types judged on the first 10 000 rows of the API's current data (pre-fills the type dropdown).
export async function columns(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store'); // changes with every upload
  res.json(await valueChecks.detectColumnTypes(req.api!));
}

// POST /api/organizations/:slug/apis/:apiSlug/design/check-values   { fields: [{ sourceColumn, type }] }
// → 200 { rows, fields: [{ sourceColumn, type, empty, cantConvert, examples }] } over EVERY row
// · 400 (unknown column) · 429 TOO_MANY_VALUE_CHECKS
export async function checkValues(req: Request, res: Response) {
  const input = validate(checkValuesSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await valueChecks.checkFieldValues(req.api!, input));
}

// POST /api/organizations/:slug/apis/:apiSlug/design/preview   { design?, ids? }
// → 200 { request (sample: GET url/query or POST body), response (the contract/1 envelope),
//         responseHeaders, notes, warnings } · 400 DESIGN_INVALID · 409 NO_DATA. Nothing is saved.
export async function preview(req: Request, res: Response) {
  const parsed = previewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Same code as a save: the Design tab shows both kinds of problems the same way.
    throw new AppError(400, 'DESIGN_INVALID', 'The design has problems', {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    });
  }
  res.set('Cache-Control', 'no-store');
  res.json(await previewDesign(req.api!, req.organization!.slug, parsed.data));
}
