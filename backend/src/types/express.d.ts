// Teach TypeScript about the fields our middleware adds to every request.
// ("Declaration merging": we add properties to Express' own Request type.)
import type { Api, DataSource } from '../generated/prisma/client.js';
import type { PublicUser } from '../modules/auth/auth.service.js';
import type { PublicOrganization } from '../modules/organizations/organizations.service.js';

declare global {
  namespace Express {
    interface Request {
      // Set by middleware/load-session.ts when the request has a valid session cookie.
      user?: PublicUser;
      sessionId?: string;
      // Set by middleware/require-organization.ts on /api/organizations/:slug routes.
      organization?: PublicOrganization;
      // Set by middleware/require-data-source.ts on /data-sources/:dataSourceId routes.
      dataSource?: DataSource;
      // Set by middleware/require-api.ts on /apis/:apiSlug routes.
      api?: Api;
    }
  }
}

export {};
