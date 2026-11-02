import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { as, createTestApp, loginAs } from './e2e-env.js';

let app: NestExpressApplication;
let db: pg.Client;
let owner: ReturnType<typeof as>; // eng-2567 (faculty 21)
let med: ReturnType<typeof as>; // faculty 30, year 2566
let arts: ReturnType<typeof as>; // faculty 22, year 2565
let admin: ReturnType<typeof as>; // faculty 23, year 2564

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  owner = as(app, await loginAs(app, 'eng-2567'));
  med = as(app, await loginAs(app, 'med-2566'));
  arts = as(app, await loginAs(app, 'arts-2565'));
  admin = as(app, await loginAs(app, 'admin'));
  await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099')",
  );
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

interface Poll {
  id: string;
  single: { id: string; options: { id: string }[] };
  multi: { id: string; options: { id: string }[] };
  text: { id: string };
}

/** Engineering + anyone who entered in 2566; skips review (not Chula-wide), then published by the owner. */
async function openPoll(
  settings: { allowAnswerEdit: boolean },
  opensAt: string | null = null,
  publishNow = false,
): Promise<Poll> {
  const { body } = await owner.post('/polls').send({
    title: 'ธีมงาน',
    opensAt,
    closesAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    audience: {
      type: 'restricted',
      rules: [{ facultyCode: '21' }, { studentYear: 2566 }],
    },
    settings,
    elements: [
      {
        type: 'single_choice',
        title: 'ธีม',
        isRequired: true,
        options: [{ label: 'ย้อนยุค' }, { label: 'ร่วมสมัย' }],
      },
      {
        type: 'multi_choice',
        title: 'กิจกรรม',
        config: { maxSelect: 2 },
        options: [{ label: 'ดนตรี' }, { label: 'อาหาร' }, { label: 'เกม' }],
      },
      { type: 'text_question', title: 'ข้อเสนอแนะ' },
    ],
  });
  const submitted = await owner.post(`/polls/${body.id}/submit`);
  expect(submitted.status).toBe(200);
  expect(submitted.body.status).toBe('approved');
  const opened = await owner
    .post(`/polls/${body.id}/publish`)
    .send(publishNow ? { now: true } : {});
  expect(opened.status).toBe(200);
  const [single, multi, text] = opened.body.elements;
  return { id: body.id, single, multi, text };
}

describe('voting with answer edits allowed', () => {
  let p: Poll;
  beforeAll(async () => {
    p = await openPoll({ allowAnswerEdit: true });
  });

  it('first vote is 201 and shows up as myBallot', async () => {
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
        {
          elementId: p.multi.id,
          optionIds: [p.multi.options[0]!.id, p.multi.options[2]!.id],
        },
        { elementId: p.text.id, text: '  สนุกดี  ' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.answers).toContainEqual({
      elementId: p.text.id,
      text: 'สนุกดี',
    });
    // minute precision only
    expect(new Date(res.body.submittedAt).getSeconds()).toBe(0);

    const detail = await med.get(`/polls/${p.id}`);
    expect(detail.body.myBallot).toEqual({ submitted: true, canEdit: true });
  });

  it('voting again replaces the answers (200), still one ballot', async () => {
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[1]!.id] },
      ],
    });
    expect(res.status).toBe(200);

    const mine = await med.get(`/polls/${p.id}/ballot`);
    expect(mine.body.answers).toEqual([
      { elementId: p.single.id, optionIds: [p.single.options[1]!.id] },
    ]);

    const counts = await db.query(
      `SELECT (SELECT count(*) FROM ballots WHERE poll_id = $1)::int AS ballots,
              (SELECT count(*) FROM ballot_choices WHERE poll_id = $1)::int AS choices,
              (SELECT count(*) FROM ballot_text_answers WHERE poll_id = $1)::int AS texts`,
      [p.id],
    );
    expect(counts.rows[0]).toEqual({ ballots: 1, choices: 1, texts: 0 });
  });

  it('reports every invalid answer', async () => {
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        {
          elementId: p.multi.id,
          optionIds: p.multi.options.map((o) => o.id),
        },
        { elementId: p.single.id, optionIds: [p.multi.options[0]!.id] },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ANSWERS');
    expect(res.body.problems.map((x: { path: string }) => x.path)).toEqual([
      'answers.0.optionIds',
      'answers.1.optionIds',
      `elements.${p.single.id}`,
    ]);
  });

  it('who may vote', async () => {
    const answer = {
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
      ],
    };
    // outside the audience: the poll doesn't exist for them
    expect((await arts.put(`/polls/${p.id}/ballot`).send(answer)).status).toBe(
      404,
    );
    // the admin can see it but isn't in the audience
    const adminVote = await admin.put(`/polls/${p.id}/ballot`).send(answer);
    expect(adminVote.status).toBe(403);
    expect(adminVote.body.code).toBe('NOT_ELIGIBLE');
    // the owner is in Engineering, so may vote
    expect((await owner.put(`/polls/${p.id}/ballot`).send(answer)).status).toBe(
      201,
    );
  });

  it('GET ballot is 404 before voting', async () => {
    const fresh = await openPoll({ allowAnswerEdit: true });
    const res = await med.get(`/polls/${fresh.id}/ballot`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_BALLOT');
  });

  it('stops accepting votes at closesAt even before the worker closes it', async () => {
    await db.query(
      "UPDATE polls SET closes_at = now() - interval '1 second' WHERE id = $1",
      [p.id],
    );
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POLL_CLOSED');
  });
});

describe('voting without answer edits', () => {
  let p: Poll;
  beforeAll(async () => {
    p = await openPoll({ allowAnswerEdit: false });
  });

  it('a burst of first votes from one person yields exactly one ballot', async () => {
    const answer = {
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
      ],
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        med.put(`/polls/${p.id}/ballot`).send(answer),
      ),
    );
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(
      results.filter((r) => r.status === 409).map((r) => r.body.code),
    ).toEqual(Array(4).fill('ALREADY_VOTED'));

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM ballots WHERE poll_id = $1',
      [p.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('myBallot says the answer is final', async () => {
    const detail = await med.get(`/polls/${p.id}`);
    expect(detail.body.myBallot).toEqual({ submitted: true, canEdit: false });
  });
});

describe('anonymity', () => {
  it('ballots hold no user reference, and keys differ per poll', async () => {
    // respondent_code is only filled for "ระบุคนส่ง" polls (codes.e2e-spec)
    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ballots' ORDER BY 1",
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      'faculty_code',
      'id',
      'poll_id',
      'respondent_code',
      'student_year',
      'submitted_at',
      'voter_key',
    ]);

    // med voted in two polls above: two different keys
    const keys = await db.query(
      "SELECT DISTINCT encode(voter_key, 'hex') AS k FROM ballots WHERE faculty_code = '30'",
    );
    expect(keys.rowCount).toBe(2);
    const named = await db.query(
      'SELECT 1 FROM ballots WHERE respondent_code IS NOT NULL',
    );
    expect(named.rowCount).toBe(0);
  });
});

describe('rate limit', () => {
  it('allows at most 20 ballot requests a minute, then 429 + Retry-After', async () => {
    const path = `/polls/${crypto.randomUUID()}/ballot`;
    let allowed = 0;
    let limited: Awaited<ReturnType<typeof arts.put>> | undefined;
    for (let i = 0; i < 25 && !limited; i++) {
      const res = await arts.put(path).send({ answers: [] });
      if (res.status === 429) limited = res;
      else allowed++;
    }
    // earlier tests in this file already spent some of arts' budget
    expect(allowed).toBeLessThanOrEqual(20);
    expect(limited?.body.code).toBe('RATE_LIMITED');
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
  });
});

/** Approved and waiting for the owner to publish. */
async function approvedPoll(opensAt: string | null = null) {
  const { body } = await owner.post('/polls').send({
    title: 'รอเปิด',
    opensAt,
    closesAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    audience: { type: 'chula' },
    elements: [{ type: 'text_question', title: 'อะไร' }],
  });
  await owner.post(`/polls/${body.id}/submit`);
  await admin.post(`/admin/polls/${body.id}/approve`);
  return body.id as string;
}

describe('publishing: now or at a time picked in the dialog', () => {
  const inHours = (h: number) =>
    new Date(Date.now() + h * 3600_000).toISOString();

  it('without a schedule opens now and records opensAt', async () => {
    const id = await approvedPoll();
    const res = await owner.post(`/polls/${id}/publish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.opensAt).not.toBeNull();
    expect(res.body.openedAt).toBe(res.body.opensAt);
    expect(new Date(res.body.opensAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it('opens at a time picked when publishing, even if none was saved', async () => {
    const id = await approvedPoll();
    const at = inHours(3);
    const res = await owner.post(`/polls/${id}/publish`).send({ opensAt: at });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'open',
      opensAt: at,
      openedAt: at,
    });
    const vote = await med.put(`/polls/${id}/ballot`).send({ answers: [] });
    expect(vote.body.code).toBe('POLL_NOT_STARTED');
  });

  it('replaces a saved schedule that already passed', async () => {
    const id = await approvedPoll(inHours(1));
    await db.query(
      "UPDATE polls SET opens_at = now() - interval '1 hour' WHERE id = $1",
      [id],
    );
    const at = inHours(2);
    const res = await owner.post(`/polls/${id}/publish`).send({ opensAt: at });
    expect(res.body.opensAt).toBe(at);
  });

  it('refuses a time in the past, after closesAt, or together with now', async () => {
    const id = await approvedPoll();
    const past = await owner
      .post(`/polls/${id}/publish`)
      .send({ opensAt: inHours(-1) });
    expect(past.status).toBe(422);
    expect(past.body).toMatchObject({
      code: 'INVALID_OPENS_AT',
      problems: [{ path: 'opensAt', message: 'เวลาเปิดโหวตต้องอยู่ในอนาคต' }],
    });
    const late = await owner
      .post(`/polls/${id}/publish`)
      .send({ opensAt: inHours(24 * 8) });
    expect(late.body.code).toBe('INVALID_OPENS_AT');
    const both = await owner
      .post(`/polls/${id}/publish`)
      .send({ now: true, opensAt: inHours(1) });
    expect(both.status).toBe(422);
    // nothing changed: still waiting to be published
    expect((await owner.get(`/polls/${id}`)).body.status).toBe('approved');
  });
});

describe('shared link opened without logging in', () => {
  const anon = (id: string) =>
    request(app.getHttpServer()).get(`/api/v1/polls/${id}/preview`);

  it('shows the intro card of a published poll, nothing more', async () => {
    const p = await openPoll({ allowAnswerEdit: false });
    const res = await anon(p.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: p.id,
      status: 'open',
      title: 'ธีมงาน',
      questionCount: 3,
      audience: { type: 'restricted' },
    });
    // viewer-independent, so the CDN may keep it briefly
    expect(res.headers['cache-control']).toContain('s-maxage=30');
    expect(res.body).not.toHaveProperty('elements');
    expect(res.body).not.toHaveProperty('myBallot');
    // the full poll still needs a login
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/polls/${p.id}`)).status,
    ).toBe(401);
  });

  it('hides polls that are not published or were taken down', async () => {
    const waiting = await approvedPoll();
    const hidden = await anon(waiting).send();
    expect(hidden.status).toBe(404);
    expect(hidden.headers['cache-control'] ?? '').not.toContain('s-maxage');

    const p = await openPoll({ allowAnswerEdit: false });
    await admin
      .post(`/admin/polls/${p.id}/takedown`)
      .send({ reason: 'ไม่เหมาะสม' });
    expect((await anon(p.id)).status).toBe(404);
  });
});

describe('scheduled opening (opensAt)', () => {
  let p: Poll;
  const opensAt = new Date(Date.now() + 86400_000).toISOString();
  beforeAll(async () => {
    p = await openPoll({ allowAnswerEdit: false }, opensAt);
  });

  it('is published and visible before it opens, with openedAt = opensAt', async () => {
    const res = await med.get(`/polls/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.opensAt).toBe(opensAt);
    expect(res.body.openedAt).toBe(opensAt);
  });

  it('refuses ballots until opensAt (409 POLL_NOT_STARTED)', async () => {
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POLL_NOT_STARTED');
  });

  it('accepts ballots once opensAt has passed', async () => {
    await db.query(
      "UPDATE polls SET opens_at = now() - interval '1 minute' WHERE id = $1",
      [p.id],
    );
    const res = await med.put(`/polls/${p.id}/ballot`).send({
      answers: [
        { elementId: p.single.id, optionIds: [p.single.options[0]!.id] },
      ],
    });
    expect(res.status).toBe(201);
  });

  it('publish { now: true } skips the schedule and accepts ballots right away', async () => {
    const q = await openPoll({ allowAnswerEdit: false }, opensAt, true);
    const poll = await med.get(`/polls/${q.id}`);
    expect(new Date(poll.body.opensAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(poll.body.openedAt).toBe(poll.body.opensAt);
    const res = await med.put(`/polls/${q.id}/ballot`).send({
      answers: [
        { elementId: q.single.id, optionIds: [q.single.options[0]!.id] },
      ],
    });
    expect(res.status).toBe(201);
  });

  it('cannot be submitted with opensAt after closesAt', async () => {
    const { body } = await owner.post('/polls').send({
      title: 'เปิดหลังปิด',
      opensAt: new Date(Date.now() + 9 * 86400_000).toISOString(),
      closesAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      elements: [{ type: 'text_question', title: 'อะไร' }],
    });
    const res = await owner.post(`/polls/${body.id}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.problems).toContainEqual(
      expect.objectContaining({ path: 'opensAt' }),
    );
  });
});
