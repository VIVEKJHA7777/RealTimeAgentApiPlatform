// CONTROLLER for an API's test switches (Phase 7, task 7.4): HTTP in/out only.
import type { Request, Response } from 'express';
import { validate } from '../../../lib/validate.js';
import { setSwitchSchema, switchKindParam } from './switches.schemas.js';
import * as switches from './switches.service.js';

// GET …/apis/:apiSlug/switches → 200 { switches (on now), catalogue, now }
export async function list(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await switches.listSwitches(req.api!));
}

// PUT …/apis/:apiSlug/switches/:kind { options?, tokenId?, minutes?, applyToOwnChecks? } → 200 (as GET)
//   · 400 SWITCH_INVALID (options, token) / VALIDATION_ERROR
export async function set(req: Request, res: Response) {
  const kind = validate(switchKindParam, req.params.kind);
  const input = validate(setSwitchSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await switches.setSwitch(req.api!, kind, input, req.user!.id, req.user!.email));
}

// DELETE …/apis/:apiSlug/switches/:kind → 200 (as GET + turnedOff) · DELETE …/switches → all off
export async function turnOff(req: Request, res: Response) {
  const kind = req.params.kind === undefined ? null : validate(switchKindParam, req.params.kind);
  res.set('Cache-Control', 'no-store');
  res.json(await switches.turnOff(req.api!, kind, req.user!.email));
}
