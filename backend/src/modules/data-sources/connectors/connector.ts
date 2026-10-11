// The contract every data source must follow: CSV today, JSON / Google Sheets later.
//
// A connector knows ONE thing: how to read its source into a header + rows of raw text.
// Everything else (header rules, id checks, types, preview, storing, versions) is shared code
// in the data-sources module, so adding a source never touches that code.
//
// To add a source later:
//   1. create connectors/<kind>.connector.ts implementing SourceConnector
//   2. add it to the list in connectors/index.ts
//   (+ its upload/settings screen in the frontend)

// What a connector gets to read from.
export type SourceInput = {
  // Uploaded file on disk (file-based sources like CSV / JSON). Undefined for remote sources.
  filePath?: string;
  // Original name, e.g. "products.csv" (for messages only).
  fileName?: string;
  // Source settings, already checked against the connector's `configSchema`
  // (e.g. { sheetUrl } for Google Sheets). `{}` for plain file uploads.
  config: Record<string, unknown>;
};

// One data row as raw text, in header order. Cleaning (trim, empty → null) is done by shared code.
export type SourceRow = {
  // Row number as a person sees it in a spreadsheet: the header is row 1, the first data row is 2.
  rowNumber: number;
  values: string[];
};

// An open source: its header and a stream of rows, read one at a time (never all in memory).
export type OpenedSource = {
  header: string[];
  rows: AsyncIterable<SourceRow>;
  // How far through the source we are, 0..1 if known (used to estimate the total row count).
  progress?: () => number | undefined;
  // Stop reading early (e.g. a preview only needs the first rows). Safe to call twice.
  close: () => void;
};

export interface SourceConnector {
  // Stored in data_sources.kind, e.g. "csv".
  kind: string;
  // Shown in the UI, e.g. "CSV file".
  label: string;
  // true: the user uploads a file (multipart field "file"). false: settings only (e.g. a URL).
  usesFile: boolean;
  // File extensions accepted when usesFile is true, e.g. [".csv"].
  fileExtensions: string[];
  // Open the source. Must throw SourceError for problems the user should fix (bad file...).
  open(input: SourceInput): Promise<OpenedSource>;
}

// A problem with the user's data (not a bug in our code): shown to the user with its row number.
//   SOURCE_INVALID   (400) the data has a problem the user can fix (bad row, broken quote...)
//   UNSUPPORTED_FILE (415) this isn't the kind of file the connector reads at all
export class SourceError extends Error {
  constructor(
    message: string,
    public readonly rowNumber?: number,
    public readonly code: 'SOURCE_INVALID' | 'UNSUPPORTED_FILE' = 'SOURCE_INVALID',
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
