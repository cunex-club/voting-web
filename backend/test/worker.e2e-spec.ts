import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { CunexClient } from '../src/modules/cunex/cunex.client.js';
import {
  MOCK_CUNEX_USERS,
  type MockCunexClient,
} from '../src/modules/cunex/mock-cunex.client.js';
import { as, createTestApp, loginAs } from './e2e-env.js';

let app: NestExpressApplication;
let worker: INestApplicationContext;
let db: pg.Client;
let owner: ReturnType<typeof as>;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  // The real worker process, consuming the same (test) Redis queue.
  const { WorkerModule } = await import('../src/worker.module.js');
  worker = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
  });
  owner = as(app, await loginAs(app, 'eng-2567'));
  // the admin account still has to exist: the role UPDATE below targets it
  await loginAs(app, 'admin');
  await loginAs(app, 'med-2566');
  await loginAs(app, 'arts-2565');
  await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099')",
  );
});

afterAll(async () => {
  await worker?.close();
  await app?.close();
  await db?.end();
});

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await check();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out waiting');
}

async function approvedPoll(audience: object, closesInMs: number) {
  const { body } = await owner.post('/polls').send({
    title: 'โพลทดสอบ worker',
    closesAt: new Date(Date.now() + closesInMs).toISOString(),
    audience,
    elements: [
      {
        type: 'single_choice',
        title: 'เลือก',
        options: [{ label: 'a' }, { label: 'b' }],
      },
    ],
  });
  // restricted and public polls skip admin review
  const submitted = await owner.post(`/polls/${body.id}/submit`);
  expect(submitted.body.status).toBe('approved');
  expect((await owner.post(`/polls/${body.id}/publish`)).status).toBe(200);
  return body.id as string;
}

it('opening a restricted poll creates a share link and notifies its audience', async () => {
  const mock = worker.get(CunexClient) as MockCunexClient;
  const id = await approvedPoll(
    // Medicine 2566 by year rule, Arts by faculty rule; the owner is excluded
    {
      type: 'restricted',
      rules: [{ studentYear: 2566 }, { facultyCode: '22' }],
    },
    60_000,
  );

  const shareUrl = await waitFor(async () => {
    const r = await db.query('SELECT share_url FROM polls WHERE id = $1', [id]);
    return r.rows[0].share_url ?? undefined;
  });
  expect(shareUrl).toMatch(/^https:\/\/cunex\.page\.link\/mock-/);

  const batch = await waitFor(async () => {
    const r = await db.query(
      'SELECT total, succeeded, failed FROM notification_batches WHERE poll_id = $1 AND finished_at IS NOT NULL',
      [id],
    );
    return r.rows[0];
  });
  expect(batch).toEqual({ total: 2, succeeded: 2, failed: 0 });

  const sent = mock.sentNotifications.filter((n) =>
    n.callbackUrl?.endsWith(`/${id}`),
  );
  expect(sent.map((n) => n.userId).sort()).toEqual(
    [
      MOCK_CUNEX_USERS['med-2566'].userId,
      MOCK_CUNEX_USERS['arts-2565'].userId,
    ].sort(),
  );
  expect(sent[0]!.callbackUrl).toBe(`http://localhost:3000/${id}`);
});

it('public polls get a share link but no notifications', async () => {
  const id = await approvedPoll({ type: 'public' }, 60_000);
  await waitFor(async () => {
    const r = await db.query('SELECT share_url FROM polls WHERE id = $1', [id]);
    return r.rows[0].share_url ?? undefined;
  });
  const batches = await db.query(
    'SELECT 1 FROM notification_batches WHERE poll_id = $1',
    [id],
  );
  expect(batches.rowCount).toBe(0);
});

it('closes the poll by itself at closesAt', async () => {
  const id = await approvedPoll({ type: 'public' }, 3_000);
  const status = await waitFor(async () => {
    const r = await db.query('SELECT status FROM polls WHERE id = $1', [id]);
    return r.rows[0].status === 'closed' ? 'closed' : undefined;
  }, 15_000);
  expect(status).toBe('closed');

  const audit = await db.query(
    "SELECT actor_id FROM audit_logs WHERE entity_id = $1 AND action = 'poll.auto_close'",
    [id],
  );
  expect(audit.rows).toEqual([{ actor_id: null }]);
});
