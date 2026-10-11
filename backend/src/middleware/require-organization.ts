import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';
import * as organizationsService from '../modules/organizations/organizations.service.js';

// For routes with a :slug param. Must come after requireAuth.
// Loads the brand ONLY if the logged-in user owns it and puts it on req.organization.
// Every brand route (now and in later phases) goes through this one check.
export async function requireOrganization(req: Request, _res: Response, next: NextFunction) {
  const slug = req.params.slug;
  const organization =
    typeof slug === 'string'
      ? await organizationsService.findOwnedOrganization(req.user!.id, slug)
      : null;

  if (!organization) {
    // Same answer whether the brand doesn't exist or belongs to someone else.
    throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Brand not found');
  }

  req.organization = organization;
  next();
}
