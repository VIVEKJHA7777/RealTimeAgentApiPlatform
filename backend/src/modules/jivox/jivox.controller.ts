// CONTROLLER for the Jivox reference data (read-only, the same for every user).
import type { Request, Response } from 'express';
import type { FeedType } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/app-error.js';
import { getFeedSchema, listFeedSchemas } from './feed-schemas.js';

const FEED_TYPES = new Set(['product', 'review', 'store', 'content']);

// The schemas only change when the server is redeployed with new CSVs: browsers may keep
// them for 5 minutes (private: only for the logged-in user's browser, never shared caches).
const CACHE = 'private, max-age=300';

// GET /api/jivox/feed-schemas → 200 { feedSchemas: [{ feedType, idColumn, fields }] }
export function list(_req: Request, res: Response) {
  res.set('Cache-Control', CACHE);
  res.json({ feedSchemas: listFeedSchemas() });
}

// GET /api/jivox/feed-schemas/:feedType → 200 { feedSchema } · 404 FEED_TYPE_NOT_FOUND
export function getOne(req: Request, res: Response) {
  const feedType = String(req.params.feedType);
  if (!FEED_TYPES.has(feedType)) {
    throw new AppError(
      404,
      'FEED_TYPE_NOT_FOUND',
      'Unknown feed type (product, review, store or content)',
    );
  }
  res.set('Cache-Control', CACHE);
  res.json({ feedSchema: getFeedSchema(feedType as FeedType) });
}
