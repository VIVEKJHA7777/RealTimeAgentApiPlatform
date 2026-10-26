// The SHAPE of a response design (PUT /apis/:apiSlug/design). Rules that need the API's data
// and feed type (does the column exist? is it a Jivox field?) are in design-rules.ts.
import { z } from 'zod';

// Keys in the response items: flat, so one plain name each (P3-7 / R4). Letters, numbers and _ only:
// Jivox reads a contract's `at` only as ^\$\.data\[\*\]\.[A-Za-z0-9_]+$ (its first real answer on qa3,
// 2026-10-12: BAD_DOCUMENT for "$.data[*].sub-category"). A "-" used to be allowed here.
export const RESPONSE_KEY = /^[A-Za-z0-9_]{1,64}$/;
export const RESPONSE_KEY_MESSAGE = "Use 1–64 letters, numbers or _ (Jivox can't read a key with - or spaces)";
const responseKey = z.string().trim().regex(RESPONSE_KEY, RESPONSE_KEY_MESSAGE);

export const FIELD_TYPES = ['string', 'int', 'float', 'boolean', 'image', 'array', 'date'] as const;

const fieldSchema = z.object({
  // Jivox schema column this value fills (contract `fields[].column_name`), e.g. "current_price".
  jivoxColumn: z.string().trim().min(1, 'Choose a Jivox field').max(100),
  // A column of the API's data, ANY name ("priceUSD", "Product Title"...). R3
  sourceColumn: z.string().min(1, 'Choose a column of your data').max(200),
  responseKey,
  // How our API converts and sends the value.
  type: z.enum(FIELD_TYPES, 'Type must be one of: string, int, float, boolean, image, array, date'),
  // false = "not in contract": the contract leaves `type` out and Jivox uses its schema's type. R5
  typeInContract: z.boolean().default(true),
  // Sent when a row has no (usable) value. "" = no default: then onEmpty decides (P3-5).
  default: z.string().max(1000).default(''),
  // A value that ISN'T of this type (e.g. "abc" for a float):
  //   send    → sent as written, as text (user's choice 2026-10-11: test data may not fit, and
  //             testing how Jivox handles it is part of the job). The default for new fields.
  //   default → treated as missing: the default, else onEmpty.
  onMismatch: z.enum(['send', 'default'], 'onMismatch must be send or default').default('send'),
  // No usable value and no default (user's choice 2026-10-11, replaces "always left out", P3-4):
  //   empty_string → the key is sent with "" (the default for new AND older fields)
  //   omit         → the key is left out (strict, the old behaviour)
  onEmpty: z.enum(['empty_string', 'omit'], 'onEmpty must be empty_string or omit').default('empty_string'),
});

// HOW Jivox calls the API: a contract/1 request template (P3-14). Only the shape here; the
// placeholder rules ({id} once, POST per-row object, context keys…) are in request-rules.ts.
const literal = z.union([z.string().max(1000), z.number(), z.boolean()]);
export const requestSchema = z.object({
  method: z.enum(['GET', 'POST'], 'method must be GET or POST'),
  // GET: one flat level of parameters (a URL can't nest), values text / number / true-false.
  query: z
    .record(z.string().trim().min(1, 'Parameter names cannot be empty').max(100), literal)
    .refine((q) => Object.keys(q).length <= 50, 'At most 50 parameters')
    .optional(),
  // POST: any JSON (objects / lists / literals at any depth, checked in request-rules.ts).
  body: z.json().optional(),
  // contract/1: 1..100; a bigger batch is split by Jivox into several calls.
  maxIdsPerCall: z
    .int('maxIdsPerCall must be a whole number')
    .min(1, 'At least 1 id per call')
    .max(100, 'At most 100 ids per call (contract/1)')
    .default(100),
});
export type RequestTemplate = z.infer<typeof requestSchema>;

export const saveDesignSchema = z.object({
  // The designVersion the user loaded (0 = no design saved yet). P3-12
  version: z.int('version must be a whole number').min(0),
  // The id field's source (the data's id column) and Jivox column are fixed (R2): only the key.
  idField: z.object({ responseKey }),
  fields: z.array(fieldSchema).max(200, 'At most 200 fields'),
  // Optional: left out = keep the saved request (or the starting one: GET ?ids={id}).
  request: requestSchema.optional(),
  // 5.6: the (agent, Jivox field) pairs this save takes away from Jivox agents, as the user saw
  // and confirmed them after a 409 AGENT_FIELDS_DROPPED. Anything not listed → asked again.
  confirmDroppedFields: z
    .array(z.object({ agentId: z.string().min(1).max(100), field: z.string().min(1).max(100) }))
    .max(2000)
    .default([]),
});

// POST /design/preview: the design being edited (optional: else the saved one) + ids.
export const previewSchema = z.object({
  design: saveDesignSchema.omit({ version: true, confirmDroppedFields: true }).optional(),
  // Real ids of the data (exact, as stored); left out = the first rows of the file.
  ids: z
    .array(z.string().min(1, 'An id cannot be empty').max(500))
    .min(1, 'Send at least one id (or leave ids out)')
    .max(100, 'At most 100 ids')
    .optional(),
});
export type PreviewInput = z.infer<typeof previewSchema>;

// POST /design/check-values: which (column, type) pairs to count over the whole data.
export const checkValuesSchema = z.object({
  fields: z
    .array(
      z.object({
        sourceColumn: z.string().min(1, 'Choose a column of your data').max(200),
        type: z.enum(FIELD_TYPES, 'Type must be one of: string, int, float, boolean, image, array, date'),
      }),
    )
    .min(1, 'Send at least one field')
    .max(200, 'At most 200 fields'),
});
export type CheckValuesInput = z.infer<typeof checkValuesSchema>;

export type SaveDesignInput = z.infer<typeof saveDesignSchema>;
export type DesignField = SaveDesignInput['fields'][number];

// What is stored in apis.design (JSONB). `version` lives in its own column.
export type StoredDesign = {
  idField: { responseKey: string };
  fields: DesignField[];
  request?: RequestTemplate; // missing in designs saved before task 3.4
};
