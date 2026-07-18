// Seam test harness: embedded Postgres + room server with a stubbed Supabase verifier.
// Tests connect as fake socket clients and assert only on what real clients receive.
import { randomInt, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createRoomServer, type RoomServer } from '../src/server/engine';
import { migrate } from '../src/server/db';
import { DEPARTMENTS, ROLES, TENURES, type Profile, type SessionState } from '../src/shared/contract';

export type Identity = { userId: string; token: string; displayName: string };

export type TestClient = {
  socket: Socket;
  states: SessionState[];
  /** Resolves with the first collected state matching pred (polls; 2s timeout). */
  stateWhere: (pred: (s: SessionState) => boolean) => Promise<SessionState>;
  emit: (event: string, payload: unknown) => Promise<any>;
};

export async function startHarness() {
  const dataDir = join(tmpdir(), `draft1-pg-${randomUUID()}`);
  const pgPort = randomInt(20000, 40000);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('draft1_test');
  const pool = new Pool({
    host: 'localhost',
    port: pgPort,
    user: 'postgres',
    password: 'postgres',
    database: 'draft1_test',
  });
  await migrate(pool);

  const tokens = new Map<string, { userId: string; displayName: string }>();
  const verifyToken = async (token: string) => tokens.get(token) ?? null;

  let server: RoomServer;
  let url: string;
  const clients: Socket[] = [];

  async function startServer(): Promise<void> {
    server = createRoomServer(pool, verifyToken);
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  }
  await startServer();

  let seq = 0;
  return {
    pool,

    /** Fake identity; profile preattached by default, pass profile: null for a profile-less one. */
    async mintIdentity(opts: { profile?: Profile | null; displayName?: string } = {}): Promise<Identity> {
      const userId = randomUUID();
      const token = randomUUID();
      const displayName = opts.displayName ?? `User ${++seq}`;
      tokens.set(token, { userId, displayName });
      if (opts.profile !== null) {
        const p = opts.profile ?? { department: DEPARTMENTS[0], role: ROLES[0], tenure: TENURES[0] };
        await pool.query(
          'insert into profiles (id, display_name, department, role, tenure) values ($1, $2, $3, $4, $5)',
          [userId, displayName, p.department, p.role, p.tenure],
        );
      }
      return { userId, token, displayName };
    },

    /** Connect a socket client; rejects with the connect_error message on handshake failure. */
    connect(identity: Identity): Promise<TestClient> {
      const socket = connectClient(url, { auth: { token: identity.token }, transports: ['websocket'] });
      clients.push(socket);
      const states: SessionState[] = [];
      socket.on('session:state', (s: SessionState) => states.push(s));
      return new Promise((resolve, reject) => {
        socket.on('connect_error', (err) => reject(err));
        socket.on('connect', () =>
          resolve({
            socket,
            states,
            stateWhere: async (pred) => {
              const deadline = Date.now() + 2000;
              for (;;) {
                const hit = [...states].reverse().find(pred);
                if (hit) return hit;
                if (Date.now() > deadline) throw new Error('timed out waiting for session:state');
                await new Promise((r) => setTimeout(r, 10));
              }
            },
            emit: (event, payload) => socket.timeout(2000).emitWithAck(event, payload),
          }),
        );
      });
    },

    /** Kill and recreate the socket server on a new port — proves state rehydrates from Postgres. */
    async restartServer(): Promise<void> {
      await server.close();
      await startServer();
    },

    url: () => url,

    async stop(): Promise<void> {
      clients.forEach((c) => c.disconnect());
      await server.close();
      await pool.end();
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;
