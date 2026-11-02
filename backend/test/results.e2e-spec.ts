import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { as, createTestApp, loginAs } from './e2e-env.js';

let app: NestExpressApplication;
let db: pg.Client;
let owner: ReturnType<typeof as>;
let voter: ReturnType<typeof as>; // med-2566, faculty 30
let admin: ReturnType<typeof as>;
let arts: ReturnType<typeof as>; // arts-2565, never votes

let pollId: string;
let questionId: string;
let optA: string;
let optB: string;
let textId: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  owner = as(app, await loginAs(app, 'eng-2567'));
  voter = as(app, await loginAs(app, 'med-2566'));
  admin = as(app, await loginAs(app, 'admin'));
  // also registers faculty 22 for the inserted ballots
  arts = as(app, await loginAs(app, 'arts-2565'));
  await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099')",
  );

  const { body } = await owner.post('/polls').send({
    title: 'ผลโหวต',
    closesAt: new Date(Date.now() + 86400_000).toISOString(),
    settings: { showResultsRealtime: false, listedPublicly: true },
    elements: [
      {
        type: 'single_choice',
        title: 'เลือก',
        options: [{ label: 'A' }, { label: 'B' }],
      },
      { type: 'text_question', title: 'ความเห็น' },
    ],
  });
  // public (the default audience) skips admin review
  await owner.post(`/polls/${body.id}/submit`);
  const opened = await owner.post(`/polls/${body.id}/publish`);
  pollId = body.id;
  questionId = opened.body.elements[0].id;
  [optA, optB] = opened.body.elements[0].options.map(
    (o: { id: string }) => o.id,
  );
  textId = opened.body.elements[1].id;

  // one real vote through the API
  const vote = await voter.put(`/polls/${pollId}/ballot`).send({
    answers: [
      { elementId: questionId, optionIds: [optB] },
      { elementId: textId, text: 'ชอบมาก' },
    ],
  });
  expect(vote.status).toBe(201);

  // 6 Engineering + 2 Arts voters, inserted directly (ballots carry no user)
  for (const [faculty, option, n] of [
    ['21', optA, 6],
    ['22', optB, 2],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const { rows } = await db.query(
        'INSERT INTO ballots (poll_id, voter_key, faculty_code) VALUES ($1, $2, $3) RETURNING id',
        [pollId, randomBytes(32), faculty],
      );
      await db.query(
        'INSERT INTO ballot_choices (ballot_id, poll_id, element_id, option_id) VALUES ($1, $2, $3, $4)',
        [rows[0].id, pollId, questionId, option],
      );
    }
  }
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe('results', () => {
  it('owner sees totals per option', async () => {
    const res = await owner.get(`/polls/${pollId}/results`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.totalBallots).toBe(9);
    const q = res.body.elements.find(
      (e: { elementId: string }) => e.elementId === questionId,
    );
    expect(q.answered).toBe(9);
    expect(q.type).toBe('single_choice');
    expect(q.options).toEqual([
      { optionId: optA, count: 6, percent: 66.7, weight: 1 },
      { optionId: optB, count: 3, percent: 33.3, weight: 0.5 },
    ]);
    const t = res.body.elements.find(
      (e: { elementId: string }) => e.elementId === textId,
    );
    expect(t).toEqual({
      elementId: textId,
      type: 'text_question',
      answered: 1,
    });
  });

  it('faculty breakdown hides groups smaller than k = 5', async () => {
    const res = await owner.get(`/polls/${pollId}/results?breakdown=faculty`);
    expect(res.body.breakdown.minGroupSize).toBe(5);
    expect(res.body.breakdown.groups).toEqual([
      {
        group: '21',
        total: 6,
        elements: [
          { elementId: questionId, options: [{ optionId: optA, count: 6 }] },
        ],
      },
      // Arts (2) + Medicine (1) = 3 < 5: no numbers at all
      { group: 'other', hidden: true },
    ]);
  });

  it('answers 304 when nothing changed', async () => {
    const first = await owner.get(`/polls/${pollId}/results`);
    const again = await owner
      .get(`/polls/${pollId}/results`)
      .set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
  });

  it('voters wait for the poll to close when live results are off', async () => {
    const hidden = await voter.get(`/polls/${pollId}/results`);
    expect(hidden.status).toBe(403);
    expect(hidden.body.code).toBe('RESULTS_HIDDEN');
  });

  it('free-text answers: owner only, no ids or times', async () => {
    const res = await owner.get(
      `/polls/${pollId}/results/text?elementId=${textId}`,
    );
    expect(res.body).toEqual({ items: [{ text: 'ชอบมาก' }], nextCursor: null });

    expect(
      (await voter.get(`/polls/${pollId}/results/text?elementId=${textId}`))
        .status,
    ).toBe(403);
    expect(
      (await owner.get(`/polls/${pollId}/results/text?elementId=${questionId}`))
        .status,
    ).toBe(404);
  });

  it('result display can only be set once the poll is open, by the owner', async () => {
    const display = {
      published: true,
      elementIds: null,
      views: ['bar'],
      showCount: true,
      showPercent: true,
      showTotal: true,
    };
    expect(
      (await voter.put(`/polls/${pollId}/result-display`).send(display)).status,
    ).toBe(404);
    const bad = await owner
      .put(`/polls/${pollId}/result-display`)
      .send({ ...display, views: [] });
    expect(bad.status).toBe(422);
    const ok = await owner.put(`/polls/${pollId}/result-display`).send(display);
    expect(ok.status).toBe(200);
    expect(ok.body.resultDisplay).toEqual(display);
  });

  it('after closing (with a reason), voters see the results', async () => {
    const closed = await owner
      .post(`/polls/${pollId}/close`)
      .send({ reason: 'ได้ข้อมูลพอแล้ว' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      status: 'closed',
      closedEarly: true,
      closeReason: 'ได้ข้อมูลพอแล้ว',
    });
    expect((await voter.get(`/polls/${pollId}`)).body.closeReason).toBe(
      'ได้ข้อมูลพอแล้ว',
    );

    const res = await voter.get(`/polls/${pollId}/results`);
    expect(res.status).toBe(200);
    expect(res.body.totalBallots).toBe(9);
    // choice questions only, never the text question
    expect(
      res.body.elements.map((e: { elementId: string }) => e.elementId),
    ).toEqual([questionId]);
    // per-group numbers stay with the owner and admins
    expect(
      (await voter.get(`/polls/${pollId}/results?breakdown=faculty`)).status,
    ).toBe(403);
  });

  it('voters get only the numbers the owner publishes', async () => {
    const set = (patch: object) =>
      owner.put(`/polls/${pollId}/result-display`).send({
        published: true,
        elementIds: null,
        views: ['list'],
        showCount: true,
        showPercent: true,
        showTotal: true,
        ...patch,
      });

    await set({ showCount: false, showTotal: false });
    const hiddenNumbers = await voter.get(`/polls/${pollId}/results`);
    expect(hiddenNumbers.body.totalBallots).toBeNull();
    expect(hiddenNumbers.body.elements[0].answered).toBeNull();
    expect(hiddenNumbers.body.elements[0].options).toEqual([
      { optionId: optA, count: null, percent: 66.7, weight: 1 },
      { optionId: optB, count: null, percent: 33.3, weight: 0.5 },
    ]);
    // the owner still sees everything
    expect(
      (await owner.get(`/polls/${pollId}/results`)).body.totalBallots,
    ).toBe(9);

    await set({ elementIds: [] });
    expect((await voter.get(`/polls/${pollId}/results`)).body.elements).toEqual(
      [],
    );

    await set({ published: false });
    const unpublished = await voter.get(`/polls/${pollId}/results`);
    expect(unpublished.status).toBe(403);
    expect(unpublished.body.code).toBe('RESULTS_HIDDEN');
    expect((await voter.get(`/polls/${pollId}`)).body.canViewResults).toBe(
      false,
    );
  });
});

describe('realtime results', () => {
  it('voters see live results only after answering', async () => {
    const { body } = await owner.post('/polls').send({
      title: 'เรียลไทม์',
      closesAt: new Date(Date.now() + 86400_000).toISOString(),
      audience: { type: 'chula' },
      settings: { showResultsRealtime: true },
      elements: [
        {
          type: 'single_choice',
          title: 'เลือก',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    });
    await owner.post(`/polls/${body.id}/submit`);
    await admin.post(`/admin/polls/${body.id}/approve`);
    const opened = await owner.post(`/polls/${body.id}/publish`);
    const q = opened.body.elements[0];

    expect((await voter.get(`/polls/${body.id}/results`)).status).toBe(403);
    await voter.put(`/polls/${body.id}/ballot`).send({
      answers: [{ elementId: q.id, optionIds: [q.options[0].id] }],
    });
    const live = await voter.get(`/polls/${body.id}/results`);
    expect(live.status).toBe(200);
    expect(live.body.elements[0].options[0].count).toBe(1);

    // someone who hasn't answered still waits
    expect((await arts.get(`/polls/${body.id}/results`)).status).toBe(403);
  });
});
