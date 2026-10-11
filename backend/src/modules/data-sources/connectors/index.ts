// The list of data source connectors. The ONLY place that knows which sources exist.
// Adding a source later (JSON, Google Sheets...) = import it and add it to CONNECTORS.
import { AppError } from '../../../lib/app-error.js';
import type { SourceConnector } from './connector.js';
import { csvConnector } from './csv.connector.js';

const CONNECTORS: SourceConnector[] = [
  csvConnector,
  // jsonConnector,         (later)
  // googleSheetConnector,  (later)
];

const byKind = new Map(CONNECTORS.map((connector) => [connector.kind, connector]));

export function getConnector(kind: string): SourceConnector {
  const connector = byKind.get(kind);
  if (!connector) {
    throw new AppError(400, 'UNSUPPORTED_SOURCE', `Unknown data source type "${kind}"`, {
      details: [{ field: 'kind', message: `Use one of: ${[...byKind.keys()].join(', ')}` }],
    });
  }
  return connector;
}

// For the UI: which sources can be chosen and what they accept.
export function listConnectors() {
  return CONNECTORS.map(({ kind, label, usesFile, fileExtensions }) => ({
    kind,
    label,
    usesFile,
    fileExtensions,
  }));
}
