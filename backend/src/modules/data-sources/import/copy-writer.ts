// Streams rows into ONE generation of `records` with Postgres COPY.
//
// COPY is a single SQL statement: if anything goes wrong (a bad row at 400 000, the server
// stops...), the whole statement is cancelled and NO row is stored. That's what makes an
// import "all or nothing" without one huge transaction.
import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pgPool } from '../../../lib/pg-pool.js';

const COPY_SQL =
  'COPY records (organization_id, data_source_id, generation, external_id, position, data) ' +
  'FROM STDIN WITH (FORMAT csv)';

// One CSV field for COPY: always quoted, quotes doubled.
const field = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export class CopyWriter {
  private finished: Promise<void>;
  private failed = false;

  private constructor(
    private readonly client: PoolClient,
    private readonly stream: ReturnType<typeof copyFrom>,
    private readonly prefix: string,
  ) {
    this.finished = new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', (err) => {
        this.failed = true;
        reject(err);
      });
    });
    this.finished.catch(() => {}); // handled in finish()/abort(); avoid "unhandled rejection"
  }

  static async open(organizationId: string, dataSourceId: string, generation: number) {
    const client = await pgPool.connect();
    const stream = client.query(copyFrom(COPY_SQL));
    const prefix = `${field(organizationId)},${field(dataSourceId)},${generation},`;
    return new CopyWriter(client, stream, prefix);
  }

  // Waits when Postgres is slower than the file ("backpressure"), so memory stays small.
  async write(externalId: string, position: number, data: Record<string, string | null>) {
    if (this.failed) await this.finished; // re-throws the COPY error
    const line = `${this.prefix}${field(externalId)},${position},${field(JSON.stringify(data))}\n`;
    if (!this.stream.write(line)) {
      await new Promise<void>((resolve) => this.stream.once('drain', resolve));
    }
  }

  // All rows sent: wait until Postgres has stored them (the COPY commits here).
  async finish() {
    try {
      this.stream.end();
      await this.finished;
      this.client.release();
    } catch (err) {
      this.client.release(err as Error); // a broken connection is thrown away, not reused
      throw err;
    }
  }

  // Cancel: Postgres rolls the whole COPY back, nothing is stored. Never throws.
  async abort() {
    this.stream.destroy(new Error('Import cancelled'));
    await this.finished.catch(() => {});
    this.client.release(new Error('COPY aborted'));
  }
}
