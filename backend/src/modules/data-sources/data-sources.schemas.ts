import { z } from 'zod';

// Multipart text fields arrive as strings in req.body (the file itself is in req.file).
const kind = z.string().trim().min(1).max(40).default('csv'); // connector, see connectors/index.ts

export const previewSchema = z.object({ kind });

export const createDataSourceSchema = z.object({
  kind,
  // Defaults to the uploaded file's name (e.g. "products.csv").
  name: z.string().trim().min(1).max(100).optional(),
  // The column that identifies a row, e.g. "sku". Must be in the file's header.
  idColumn: z.string().trim().min(1, 'Choose the id column').max(200),
});

export const startImportSchema = z.object({
  // replace: the file becomes the data · merge: add/update rows, keep rows missing from the file
  mode: z.enum(['replace', 'merge']).default('replace'),
});

// GET /data-sources/:id/records (query string; values arrive as text)
//   browse in file order:  ?limit=50&afterPosition=100   (position of the last row you have)
//   search by id prefix:   ?search=SKU-12&afterId=SKU-1299 (id of the last row you have)
// Both are "keyset" pages: the database jumps straight to the next row through an index, so
// page 10 000 is as fast as page 1 (OFFSET would read and throw away all earlier rows).
export const listRecordsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    // Positions are 1, 2, 3… with no gaps, so afterPosition=(page - 1) × limit opens any page.
    afterPosition: z.coerce.number().int().min(0).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    afterId: z.string().min(1).max(1000).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.search !== undefined && query.afterPosition !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['afterPosition'],
        message: 'Use afterId (not afterPosition) to page through search results',
      });
    }
    if (query.search === undefined && query.afterId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['afterId'], message: 'afterId needs search' });
    }
  });

export type PreviewInput = z.infer<typeof previewSchema>;
export type CreateDataSourceInput = z.infer<typeof createDataSourceSchema>;
export type StartImportInput = z.infer<typeof startImportSchema>;
export type ListRecordsInput = z.infer<typeof listRecordsSchema>;
