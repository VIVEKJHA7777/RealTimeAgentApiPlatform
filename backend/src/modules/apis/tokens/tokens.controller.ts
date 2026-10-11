// CONTROLLER for an API's tokens: HTTP in/out only. Every answer is `no-store`: tokens and their
// states must never be kept by a browser or proxy cache. Tokens never appear in logs (the request
// logger logs no bodies; token headers are redacted).
import type { Request, Response } from 'express';
import { validate } from '../../../lib/validate.js';
import { authHeaderSchema, createTokenSchema, renewTokenSchema, updateTokenSchema } from './tokens.schemas.js';
import * as tokensService from './tokens.service.js';

const tokenId = (req: Request) => String(req.params.tokenId);

// GET …/apis/:apiSlug/tokens → 200 { tokens: [tokenInfo], authHeader, limits }
export async function list(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await tokensService.listTokens(req.api!));
}

// POST …/tokens { name, expiresAt? (ISO or null = never) } → 201 { token, tokenInfo }
// · 400 VALIDATION_ERROR · 409 TOKEN_NAME_TAKEN / TOO_MANY_TOKENS
export async function create(req: Request, res: Response) {
  const input = validate(createTokenSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await tokensService.createToken(req.api!, input));
}

// GET …/tokens/:tokenId/reveal → 200 { token, tokenInfo } · 404 · 409 TOKEN_REVOKED / TOKEN_UNREADABLE
export async function reveal(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await tokensService.revealToken(req.api!, tokenId(req)));
}

// PATCH …/tokens/:tokenId { name?, expiresAt? } → 200 { tokenInfo } (rename / Extend)
// · 400 · 404 · 409 TOKEN_REVOKED / TOKEN_NAME_TAKEN
export async function update(req: Request, res: Response) {
  const input = validate(updateTokenSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await tokensService.updateToken(req.api!, tokenId(req), input));
}

// POST …/tokens/:tokenId/renew { expiresAt? } → 201 { token, tokenInfo, replaced } · 404 · 409 TOKEN_REVOKED
export async function renew(req: Request, res: Response) {
  const input = validate(renewTokenSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await tokensService.renewToken(req.api!, tokenId(req), input));
}

// DELETE …/tokens/:tokenId → 200 { tokenInfo } (revoked; doing it again gives the same answer) · 404
export async function revoke(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await tokensService.revokeToken(req.api!, tokenId(req)));
}

// PUT …/apis/:apiSlug/auth-header { style: "x-api-key" | "bearer" } → 200 { authHeader }
export async function setAuthHeader(req: Request, res: Response) {
  const { style } = validate(authHeaderSchema, req.body ?? {});
  res.json(await tokensService.setAuthHeader(req.api!, style));
}
