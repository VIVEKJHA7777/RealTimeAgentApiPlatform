// CONTROLLER layer for brands: reads the request, calls the service, writes the response.
import type { Request, Response } from 'express';
import { validate } from '../../lib/validate.js';
import { createOrganizationSchema } from './organizations.schemas.js';
import * as organizationsService from './organizations.service.js';

// POST /api/organizations  { name, slug }   → 201 { organization }
// `slug` is the start of the slug; the final one gets a random suffix (acme-shoes-k3x9q2).
// The owner is always the logged-in user; an `ownerId` in the body is ignored.
export async function create(req: Request, res: Response) {
  const input = validate(createOrganizationSchema, req.body);
  const organization = await organizationsService.createOrganization(req.user!.id, input);
  res.status(201).json({ organization });
}

// GET /api/organizations   → 200 { organizations: [...] }  (only mine, newest first)
export async function list(req: Request, res: Response) {
  const organizations = await organizationsService.listOrganizations(req.user!.id);
  res.json({ organizations });
}

// GET /api/organizations/:slug   → 200 { organization }
// requireOrganization already loaded it (and returned 404 if it isn't mine).
export function getOne(req: Request, res: Response) {
  res.json({ organization: req.organization });
}
