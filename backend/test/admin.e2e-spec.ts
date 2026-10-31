import type { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import type pg from 'pg';
import { redisOptions } from '../src/infra/queue/queue.module.js';
import { POLLS_QUEUE } from '../src/modules/polls/poll-jobs.js';
import { TEST_REDIS_URL, as, createTestApp, loginAs } from './e2e-env.js';

let app: NestExpressApplication;
let db: pg.Client;
let queue: Queue;
let owner: ReturnType<typeof as>; // eng-2567
let voter: ReturnType<typeof as>; // med-2566
let admin: ReturnType<typeof as>;
let adminId: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  queue = new Queue(POLLS_QUEUE, { connection: redisOptions(TEST_REDIS_URL) });
  owner = as(app, await loginAs(app, 'eng-2567'));
  voter = as(app, await loginAs(app, 'med-2566'));
  admin = as(app, await loginAs(app, 'admin'));
  // First admin comes from ADMIN_BOOTSTRAP_CUNEX_IDS in real deployments.
  const { rows } = await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099') RETURNING id",
  );
  adminId = rows[0].id;
});

afterAll(async () => {
  await queue?.close();
  await app?.close();
  await db?.end();
});

const days = (n: number) =>
  new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

async function submittedPoll(title: string) {
  const { body } = await owner.post('/polls').send({
    title,
    closesAt: days(7),
    // only Chula-wide polls go through the review queue
    audience: { type: 'chula' },
    settings: { listedPublicly: true },
    elements: [
      {
        type: 'single_choice',
        title: 'เลือกหนึ่ง',
        options: [{ label: 'a' }, { label: 'b' }],
      },
    ],
  });
  const res = await owner.post(`/polls/${body.id}/submit`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('pending_review');
  return body.id as string;
}

describe('access', () => {
  it('non-admins get 403 on every admin route', async () => {
    for (const path of ['/admin/polls', '/admin/admins', '/admin/audit-logs']) {
      const res = await voter.get(path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });
});

describe('review queue', () => {
  let first: string;
  let second: string;

  beforeAll(async () => {
    first = await submittedPoll('first');
    await new Promise((r) => setTimeout(r, 5));
    second = await submittedPoll('second');
  });

  it('lists pending polls oldest first', async () => {
    const res = await admin.get('/admin/polls');
    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });

  it('reject sends the poll back to the owner, with or without a comment', async () => {
    const res = await admin
      .post(`/admin/polls/${second}/reject`)
      .send({ comment: 'ตัวเลือกไม่ชัดเจน' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const mine = await owner.get(`/polls/${second}`);
    expect(mine.body.reviews).toEqual([
      expect.objectContaining({
        decision: 'rejected',
        comment: 'ตัวเลือกไม่ชัดเจน',
      }),
    ]);

    // rejected polls are editable and can be resubmitted
    const put = await owner
      .put(`/polls/${second}`)
      .set('If-Match', String(mine.body.version))
      .send({
        title: 'second, fixed',
        closesAt: days(7),
        audience: { type: 'chula' },
        elements: [
          {
            type: 'single_choice',
            title: 'เลือกหนึ่ง',
            options: [{ label: 'ชัดขึ้น a' }, { label: 'ชัดขึ้น b' }],
          },
        ],
      });
    expect(put.status).toBe(200);
    expect((await owner.post(`/polls/${second}/submit`)).status).toBe(200);

    // no comment at all is fine too
    const bare = await admin.post(`/admin/polls/${second}/reject`);
    expect(bare.status).toBe(200);
    expect(bare.body.reviews[0]).toMatchObject({
      decision: 'rejected',
      comment: null,
    });
  });

  it('approve waits for the owner; publish opens the poll and queues its jobs', async () => {
    const res = await admin.post(`/admin/polls/${first}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.openedAt).toBeNull();
    expect(await queue.getJob(`opened-${first}`)).toBeFalsy();
    // not visible to voters until it opens
    expect((await voter.get(`/polls/${first}`)).status).toBe(404);
    expect(
      (await admin.get('/admin/polls?status=approved')).body.items.map(
        (p: { id: string }) => p.id,
      ),
    ).toContain(first);

    // only the owner publishes
    expect((await admin.post(`/polls/${first}/publish`)).status).toBe(404);
    const opened = await owner.post(`/polls/${first}/publish`);
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('open');
    expect(opened.body.openedAt).toBeTruthy();
    expect((await owner.post(`/polls/${first}/publish`)).status).toBe(409);

    expect(await queue.getJob(`opened-${first}`)).toBeTruthy();
    const close = await queue.getJob(`close-${first}`);
    expect(await close?.getState()).toBe('delayed');
    // ~7 days out
    expect(close!.opts.delay).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

    expect((await voter.get(`/polls/${first}`)).status).toBe(200);
    expect((await admin.post(`/admin/polls/${first}/approve`)).status).toBe(
      409,
    );
  });

  it('moving closesAt reschedules the close job', async () => {
    const res = await owner
      .patch(`/polls/${first}/closes-at`)
      .send({ closesAt: days(1) });
    expect(res.status).toBe(200);
    const close = await queue.getJob(`close-${first}`);
    expect(close!.opts.delay).toBeLessThan(1.01 * 24 * 3600 * 1000);
  });

  it('realtime can change until the poll is published', async () => {
    const id = await submittedPoll('realtime');
    const pending = await owner
      .patch(`/polls/${id}/realtime`)
      .send({ showResultsRealtime: true });
    expect(pending.status).toBe(200);
    expect(pending.body.settings.showResultsRealtime).toBe(true);

    await admin.post(`/admin/polls/${id}/approve`);
    const approved = await owner
      .patch(`/polls/${id}/realtime`)
      .send({ showResultsRealtime: false });
    expect(approved.body.settings.showResultsRealtime).toBe(false);

    await owner.post(`/polls/${id}/publish`);
    const open = await owner
      .patch(`/polls/${id}/realtime`)
      .send({ showResultsRealtime: true });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe('POLL_LOCKED');
  });

  it('publish refuses a poll whose closing time already passed', async () => {
    const id = await submittedPoll('approved-then-expired');
    await admin.post(`/admin/polls/${id}/approve`);
    await db.query(
      "UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    const res = await owner.post(`/polls/${id}/publish`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOSES_AT_PASSED');

    // moving closesAt is allowed while approved, then publish works
    await owner.patch(`/polls/${id}/closes-at`).send({ closesAt: days(2) });
    expect((await owner.post(`/polls/${id}/publish`)).status).toBe(200);
  });

  it('refuses to approve a poll whose closing time already passed', async () => {
    const id = await submittedPoll('expired');
    await db.query(
      "UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    const res = await admin.post(`/admin/polls/${id}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOSES_AT_PASSED');
  });

  it('takedown closes the poll, hides it, cancels the close job', async () => {
    const res = await admin
      .post(`/admin/polls/${first}/takedown`)
      .send({ reason: 'เนื้อหาไม่เหมาะสม' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'closed',
      settings: { listedPublicly: false },
    });
    expect(await queue.getJob(`close-${first}`)).toBeFalsy();

    // the owner sees that, and why
    expect((await owner.get(`/polls/${first}`)).body).toMatchObject({
      takenDown: true,
      takedownReason: 'เนื้อหาไม่เหมาะสม',
    });

    const feed = await voter.get('/polls?status=closed');
    expect(feed.body.items.map((p: { id: string }) => p.id)).not.toContain(
      first,
    );
    // nor reachable by link: content, results and ballots are gone for voters
    expect((await voter.get(`/polls/${first}`)).status).toBe(404);
    expect((await voter.get(`/polls/${first}/results`)).status).toBe(404);
    expect((await voter.get(`/polls/${first}/ballot`)).status).toBe(404);
  });

  it('every decision is in the audit log', async () => {
    const res = await admin.get(`/admin/audit-logs?entityId=${first}`);
    expect(res.body.items.map((l: { action: string }) => l.action)).toEqual([
      'poll.takedown',
      'poll.closes_at',
      'poll.publish',
      'poll.approve',
      'poll.submit',
    ]);
    expect(res.body.items[0].data).toEqual({ reason: 'เนื้อหาไม่เหมาะสม' });
  });
});

describe('managing admins', () => {
  it('grants admin by student id; takes effect on the next request', async () => {
    expect((await voter.get('/admin/polls')).status).toBe(403);

    const res = await admin
      .post('/admin/admins')
      .send({ studentId: '6630000230' });
    expect(res.status).toBe(201);
    expect(res.body).toContainEqual(
      expect.objectContaining({
        studentId: '6630000230',
        cunexUserId: '100000000000000002',
      }),
    );

    expect((await voter.get('/admin/polls')).status).toBe(200);
  });

  it('revokes admin immediately, but not your own', async () => {
    const me = await voter.get('/me');
    expect((await admin.delete(`/admin/admins/${me.body.id}`)).status).toBe(
      204,
    );
    expect((await voter.get('/admin/polls')).status).toBe(403);

    const self = await admin.delete(`/admin/admins/${adminId}`);
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('CANNOT_REVOKE_SELF');
  });

  it('cannot grant someone who never logged in', async () => {
    const res = await admin
      .post('/admin/admins')
      .send({ studentId: '6999999999' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');

    const malformed = await admin
      .post('/admin/admins')
      .send({ studentId: '12345' });
    expect(malformed.status).toBe(422);
  });
});
