// CSV files. The only CSV-specific code: everything after "header + rows" is shared.
//
// Streams the file: a 200 MB file is read piece by piece, never loaded into memory at once.
// Handled (not errors): UTF-8 BOM, Windows line endings, quoted values with commas, quotes ("")
// or line breaks inside, empty lines, and the delimiters , ; tab | (detected from the header).
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { CsvError, parse } from 'csv-parse';
import {
  SourceError,
  type OpenedSource,
  type SourceConnector,
  type SourceRow,
} from './connector.js';

const SNIFF_BYTES = 64 * 1024; // how much of the start we look at before parsing
const DELIMITERS = [',', ';', '\t', '|'];
const REPLACEMENT_CHAR = '�'; // what invalid UTF-8 bytes turn into when decoded

async function readStart(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Spreadsheet exports use "," or ";" (some countries) or tab. Pick the one that appears most
// often in the header line, outside quotes. Default ",".
function detectDelimiter(firstLine: string): string {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  let best = ',';
  for (const [delimiter, count] of counts) if (count > counts.get(best)!) best = delimiter;
  return best;
}

// csv-parse errors → messages a person understands, with the spreadsheet row number.
function toSourceError(err: CsvError): SourceError {
  const row = ((err as { records?: number }).records ?? 0) + 1;
  switch (err.code) {
    case 'CSV_QUOTE_NOT_CLOSED':
      return new SourceError(`Row ${row}: a quote (") is opened but never closed`, row);
    case 'CSV_INVALID_CLOSING_QUOTE':
      return new SourceError(`Row ${row}: unexpected text right after a closing quote (")`, row);
    default:
      return new SourceError(`Row ${row}: ${err.message.split('\n')[0]}`, row);
  }
}

export const csvConnector: SourceConnector = {
  kind: 'csv',
  label: 'CSV file',
  usesFile: true,
  fileExtensions: ['.csv'],

  async open({ filePath }): Promise<OpenedSource> {
    if (!filePath) throw new Error('csvConnector.open() needs a filePath'); // a bug, not user data

    const { size } = await stat(filePath);
    const start = await readStart(filePath);
    if (size === 0 || start.toString('utf8').trim() === '') {
      throw new SourceError('The file is empty');
    }
    // Text files never contain byte 0; images, PDFs, Excel (.xlsx) files do.
    if (start.includes(0)) {
      throw new SourceError(
        "This isn't a CSV text file. In Excel or Google Sheets use File → Download / Save as → CSV.",
        undefined,
        'UNSUPPORTED_FILE',
      );
    }

    const firstLine = start.toString('utf8').replace(/^﻿/, '').split(/\r?\n/, 1)[0];
    const delimiter = detectDelimiter(firstLine);

    const fileStream = createReadStream(filePath);
    const parser = fileStream.pipe(
      parse({
        bom: true, // drop the invisible "byte order mark" Excel adds
        delimiter,
        relax_column_count: true, // rows with too many/few values are reported by shared code
        skip_empty_lines: true,
        info: true, // gives us the record number (= spreadsheet row) of each row
      }),
    );
    // If the file stream fails (e.g. deleted while reading), make the parser fail too.
    fileStream.on('error', (err) => parser.destroy(err));

    const iterator: AsyncIterator<{ record: string[]; info: { records: number; bytes: number } }> =
      parser[Symbol.asyncIterator]();

    const next = async () => {
      try {
        return await iterator.next();
      } catch (err) {
        throw err instanceof CsvError ? toSourceError(err) : err;
      }
    };

    const close = () => {
      fileStream.destroy();
      parser.destroy();
    };

    const first = await next();
    if (first.done) {
      close();
      throw new SourceError('The file is empty');
    }
    const header = first.value.record;
    if (header.some((name) => name.includes(REPLACEMENT_CHAR))) {
      close();
      throw new SourceError(
        'The file isn\'t UTF-8 text (some characters can\'t be read). Save it as "CSV UTF-8" and upload again.',
        1,
      );
    }

    // Bytes up to the last row we actually HANDED OUT. (The parser reads ahead in the background,
    // so its own position is further along than the rows we've used: estimates would be too low.)
    let bytesConsumed = 0;

    async function* rows(): AsyncGenerator<SourceRow> {
      while (true) {
        const result = await next();
        if (result.done) return;
        const { record, info } = result.value;
        if (record.some((value) => value.includes(REPLACEMENT_CHAR))) {
          throw new SourceError(
            `Row ${info.records}: contains characters that aren't UTF-8. Save the file as "CSV UTF-8".`,
            info.records,
          );
        }
        bytesConsumed = info.bytes;
        yield { rowNumber: info.records, values: record };
      }
    }

    return {
      header,
      rows: rows(),
      // Bytes of the rows used so far / file size = how far we are (0..1).
      progress: () => (bytesConsumed && size ? Math.min(bytesConsumed / size, 1) : undefined),
      close,
    };
  },
};
