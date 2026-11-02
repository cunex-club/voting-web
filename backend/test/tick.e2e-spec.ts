import type { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import type pg from 'pg';
import request from 'supertest';
import { redisOptions } from '../src/infra/queue/queue.module.js';
import { CunexClient } from '../src/modules/cunex/cunex.client.js';
import type { MockCunexClient } from '../src/modules/cunex/mock-cunex.client.js';
import { POLLS_QUEUE } from '../src/modules/polls/poll-jobs.js';
import { TEST_REDIS_URL, as, createTestApp, loginAs } from './e2e-env.js';

// JOBS_MODE=sweep: no worker; a cron calls GET /internal/tick instead.
const SECRET = 'tick-secret-0123456789-0123456789-abcdef';

let app: NestExpressApplication;
let db: pg.Client;
let queue: Queue;
let owner: ReturnType<typeof as>;

beforeAll(async () => {
  ({ app, db } = await createTestApp({
    JOBS_MODE: 'sweep',
    CRON_SECRET: SECRET,
  }));
  queue = new Queue(POLLS_QUEUE, { connection: redisOptions(TEST_REDIS_URL) });
  owner = as(app, await loginAs(app, 'eng-2567'));
  // the admin account still has to exist: the role UPDATE below targets it
  await loginAs(app, 'admin');
  await loginAs(app, 'med-2566');
  await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099')",
  );
});

afterAll(async () => {
  await queue?.close();
  await app?.close();
  await db?.end();
});

const tick = (auth?: string) => {
  const r = request(app.getHttpServer()).get('/api/v1/internal/tick');
  return auth ? r.set('Authorization', auth) : r;
};

async function publishedPoll() {
  const { body } = await owner.post('/polls').send({
    title: 'sweep',
    closesAt: new Date(Date.now() + 86400_000).toISOString(),
    audience: { type: 'restricted', rules: [{ studentYear: 2566 }] },
    elements: [
      {
        type: 'single_choice',
        title: 'เลือก',
        options: [{ label: 'a' }, { label: 'b' }],
      },
    ],
  });
  // restricted polls skip admin review
  await owner.post(`/polls/${body.id}/submit`);
  expect((await owner.post(`/polls/${body.id}/publish`)).status).toBe(200);
  return body.id as string;
}

it('purges sessions that expired', async () => {
  await db.query(
    "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000002')",
  );
  const res = await tick(`Bearer ${SECRET}`);
  expect(res.body.sessionsPurged).toBeGreaterThanOrEqual(1);
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM sessions WHERE expires_at <= now()',
  );
  expect(rows[0].n).toBe(0);
});

it('refuses callers without the secret', async () => {
  expect((await tick()).status).toBe(404);
  expect((await tick('Bearer wrong')).status).toBe(404);
});

it('publishing queues nothing; the tick announces, then closes at closesAt', async () => {
  const mock = app.get(CunexClient) as MockCunexClient;
  mock.sentNotifications.length = 0;
  const id = await publishedPoll();
  expect(await queue.getJob(`opened-${id}`)).toBeFalsy();
  expect(await queue.getJob(`close-${id}`)).toBeFalsy();

  const first = await tick(`Bearer ${SECRET}`);
  expect(first.status).toBe(200);
  expect(first.body.announced).toBeGreaterThanOrEqual(1);
  expect((await owner.get(`/polls/${id}`)).body.shareUrl).toBeTruthy();
  // med-2566 matches the year rule; the owner is never notified
  expect(mock.sentNotifications.length).toBe(1);

  // nothing new to announce: no second notification
  await tick(`Bearer ${SECRET}`);
  expect(mock.sentNotifications.length).toBe(1);

  await db.query(
    "UPDATE polls SET closes_at = now() - interval '1 second' WHERE id = $1",
    [id],
  );
  const closing = await tick(`Bearer ${SECRET}`);
  expect(closing.body.closed).toBeGreaterThanOrEqual(1);
  expect((await owner.get(`/polls/${id}`)).body.status).toBe('closed');
});

it('without CUNEX share links: shares the web link and still notifies', async () => {
  const mock = app.get(CunexClient) as MockCunexClient;
  mock.sentNotifications.length = 0;
  mock.failShareLinks = true;
  try {
    const id = await publishedPoll();
    expect((await tick(`Bearer ${SECRET}`)).status).toBe(200);
    expect((await owner.get(`/polls/${id}`)).body.shareUrl).toBe(
      `http://localhost:3000/${id}`,
    );
    expect(mock.sentNotifications).toHaveLength(1);
    expect(mock.sentNotifications[0]!.callbackUrl).toBe(
      `http://localhost:3000/${id}`,
    );
  } finally {
    mock.failShareLinks = false;
  }
});
