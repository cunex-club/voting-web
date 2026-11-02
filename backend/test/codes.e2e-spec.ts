import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { CunexClient } from '../src/modules/cunex/cunex.client.js';
import type { MockCunexClient } from '../src/modules/cunex/mock-cunex.client.js';
import { PollEvents } from '../src/modules/polls/poll-events.service.js';
import { as, createTestApp, loginAs } from './e2e-env.js';

// "ระบุรหัส" (audience: codes) and "ระบุคนส่ง" (settings.identifySender).

let app: NestExpressApplication;
let db: pg.Client;
let owner: ReturnType<typeof as>; // eng-2567, student 6730000121
let med: ReturnType<typeof as>; // student 6630000230
let arts: ReturnType<typeof as>; // student 6530000322
let staff: ReturnType<typeof as>; // staff 10000050
let admin: ReturnType<typeof as>;

const MED = '6630000230';
const STAFF = '10000050';
const week = () => new Date(Date.now() + 7 * 86400_000).toISOString();

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  owner = as(app, await loginAs(app, 'eng-2567'));
  med = as(app, await loginAs(app, 'med-2566'));
  arts = as(app, await loginAs(app, 'arts-2565'));
  staff = as(app, await loginAs(app, 'staff'));
  admin = as(app, await loginAs(app, 'admin'));
  await db.query(
    "UPDATE users SET role = 'admin' WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = '100000000000000099')",
  );
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

const questions = [
  {
    type: 'single_choice',
    title: 'ข้อ 1',
    isRequired: true,
    options: [{ label: 'ก' }, { label: 'ข' }, { label: 'ค' }],
  },
  { type: 'text_question', title: 'อธิบาย, สั้นๆ' },
];

async function publish(draft: Record<string, unknown>) {
  const { body } = await owner
    .post('/polls')
    .send({
      title: 'แบบทดสอบ',
      closesAt: week(),
      elements: questions,
      ...draft,
    });
  const submitted = await owner.post(`/polls/${body.id}/submit`);
  expect(submitted.status).toBe(200);
  const opened = await owner
    .post(`/polls/${body.id}/publish`)
    .send({ now: true });
  expect(opened.status).toBe(200);
  return opened.body as {
    id: string;
    elements: { id: string; options?: { id: string }[] }[];
  };
}

describe('code list audience', () => {
  it('stores the list without duplicates and checks the id format', async () => {
    const bad = await owner.post('/polls').send({
      audience: { type: 'codes', codes: ['123', MED] },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.problems[0].path).toBe('audience.codes.0');

    const res = await owner.post('/polls').send({
      audience: { type: 'codes', codes: [MED, ` ${MED} `, STAFF] },
    });
    expect(res.status).toBe(201);
    expect(res.body.audience).toEqual({
      type: 'codes',
      codeCount: 2,
      codes: [STAFF, MED],
    });
  });

  it('needs at least one id to submit, then skips admin review', async () => {
    const { body } = await owner.post('/polls').send({
      title: 'ว่าง',
      closesAt: week(),
      audience: { type: 'codes', codes: [] },
      elements: questions,
    });
    const empty = await owner.post(`/polls/${body.id}/submit`);
    expect(empty.status).toBe(422);
    expect(empty.body.problems).toContainEqual(
      expect.objectContaining({ path: 'audience.codes' }),
    );

    const put = await owner
      .put(`/polls/${body.id}`)
      .set('If-Match', String(body.version))
      .send({
        title: 'ว่าง',
        closesAt: week(),
        audience: { type: 'codes', codes: [MED] },
        elements: questions,
      });
    expect(put.status).toBe(200);
    const ok = await owner.post(`/polls/${body.id}/submit`);
    expect(ok.body.status).toBe('approved');
  });

  it('only listed students and staff can see, find and answer it', async () => {
    const p = await publish({
      audience: { type: 'codes', codes: [MED, STAFF] },
      settings: { listedPublicly: true },
    });
    const answer = {
      answers: [
        {
          elementId: p.elements[0]!.id,
          optionIds: [p.elements[0]!.options![0]!.id],
        },
      ],
    };

    const seen = await med.get(`/polls/${p.id}`);
    expect(seen.status).toBe(200);
    // voters learn how many are listed, never who
    expect(seen.body.audience).toEqual({ type: 'codes', codeCount: 2 });
    expect((await med.put(`/polls/${p.id}/ballot`).send(answer)).status).toBe(
      201,
    );
    expect((await staff.put(`/polls/${p.id}/ballot`).send(answer)).status).toBe(
      201,
    );

    expect((await arts.get(`/polls/${p.id}`)).status).toBe(404);
    expect((await arts.put(`/polls/${p.id}/ballot`).send(answer)).status).toBe(
      404,
    );
    // the owner is not on the list: sees it, may not answer
    const own = await owner.put(`/polls/${p.id}/ballot`).send(answer);
    expect(own.body.code).toBe('NOT_ELIGIBLE');

    const ids = async (who: typeof med) =>
      (
        (await who.get('/polls?status=open')).body.items as { id: string }[]
      ).map((i) => i.id);
    expect(await ids(med)).toContain(p.id);
    expect(await ids(staff)).toContain(p.id);
    expect(await ids(arts)).not.toContain(p.id);
  });

  it('notifies only the listed ids when it opens', async () => {
    const p = await publish({ audience: { type: 'codes', codes: [MED] } });
    const mock = app.get(CunexClient) as MockCunexClient;
    mock.sentNotifications.length = 0;
    await app.get(PollEvents).opened(p.id);
    expect(mock.sentNotifications.map((n) => n.userId)).toEqual([
      '100000000000000002',
    ]);
  });
});

describe('identify sender', () => {
  it('cannot be used on a public poll', async () => {
    const res = await owner.post('/polls').send({
      audience: { type: 'public' },
      settings: { identifySender: true },
    });
    expect(res.status).toBe(422);
    expect(res.body.problems[0].path).toBe('settings.identifySender');
  });

  it('shows the owner each id with its answers, as JSON and CSV', async () => {
    const q = await publish({
      audience: { type: 'codes', codes: [MED, STAFF] },
      settings: { identifySender: true, allowAnswerEdit: true },
    });
    const [single, text] = q.elements;
    // told before answering, even before login
    const preview = await request(app.getHttpServer()).get(
      `/api/v1/polls/${q.id}/preview`,
    );
    expect(preview.body.identifySender).toBe(true);
    expect((await med.get(`/polls/${q.id}`)).body.settings.identifySender).toBe(
      true,
    );

    await med.put(`/polls/${q.id}/ballot`).send({
      answers: [
        { elementId: single!.id, optionIds: [single!.options![1]!.id] },
        { elementId: text!.id, text: '=SUM(A1), "ok"' },
      ],
    });
    await staff.put(`/polls/${q.id}/ballot`).send({
      answers: [
        { elementId: single!.id, optionIds: [single!.options![2]!.id] },
      ],
    });

    const res = await owner.get(`/polls/${q.id}/results/responses`);
    expect(res.status).toBe(200);
    const byCode = new Map(
      (res.body.items as { code: string; answers: unknown[] }[]).map((i) => [
        i.code,
        i.answers,
      ]),
    );
    expect(byCode.get(MED)).toEqual([
      { elementId: single!.id, optionIds: [single!.options![1]!.id] },
      { elementId: text!.id, text: '=SUM(A1), "ok"' },
    ]);
    expect(byCode.get(STAFF)).toEqual([
      { elementId: single!.id, optionIds: [single!.options![2]!.id] },
    ]);
    // admins too; voters never
    expect((await admin.get(`/polls/${q.id}/results/responses`)).status).toBe(
      200,
    );
    expect((await med.get(`/polls/${q.id}/results/responses`)).status).toBe(
      403,
    );

    const csv = await owner.get(`/polls/${q.id}/results/responses.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('รหัส,เวลาที่ส่ง,ข้อ 1,"อธิบาย, สั้นๆ"');
    const medLine = lines.find((l) => l.startsWith(MED))!;
    // formula defused, quotes doubled
    expect(medLine).toMatch(/,ข,"'=SUM\(A1\), ""ok"""$/);
  });

  it('is unavailable for polls that did not tell voters', async () => {
    const p = await publish({ audience: { type: 'codes', codes: [MED] } });
    const single = p.elements[0]!;
    await med.put(`/polls/${p.id}/ballot`).send({
      answers: [{ elementId: single.id, optionIds: [single.options![0]!.id] }],
    });
    const res = await owner.get(`/polls/${p.id}/results/responses`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SENDER_NOT_IDENTIFIED');
    const { rows } = await db.query(
      'SELECT respondent_code FROM ballots WHERE poll_id = $1',
      [p.id],
    );
    expect(rows).toEqual([{ respondent_code: null }]);
  });

  it('the code list is locked with the rest of the poll after submit', async () => {
    const p = await publish({ audience: { type: 'codes', codes: [MED] } });
    await expect(
      db.query('UPDATE poll_audience_codes SET code = $2 WHERE poll_id = $1', [
        p.id,
        '6530000322',
      ]),
    ).rejects.toThrow(/locked/);
  });
});
