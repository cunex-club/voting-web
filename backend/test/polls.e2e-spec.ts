import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { as, createTestApp, loginAs } from './e2e-env.js';

let app: NestExpressApplication;
let db: pg.Client;
let eng: ReturnType<typeof as>; // owner: Engineering, entry year 2567
let med: ReturnType<typeof as>; // Medicine, 2566
let arts: ReturnType<typeof as>; // Arts, 2565
let admin: ReturnType<typeof as>;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  eng = as(app, await loginAs(app, 'eng-2567'));
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

const inTwoWeeks = () =>
  new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

const completeDraft = () => ({
  title: 'ธีมงานปีนี้',
  description: 'ช่วยกันเลือกหน่อย',
  closesAt: inTwoWeeks(),
  audience: {
    type: 'restricted',
    rules: [{ facultyCode: '21' }, { studentYear: 2566 }],
  },
  settings: { listedPublicly: true, allowAnswerEdit: true },
  elements: [
    {
      type: 'single_choice',
      title: 'อยากให้ธีมงานปีนี้เป็นแบบไหน',
      isRequired: true,
      options: [
        { label: 'ย้อนยุคสยาม' },
        {
          label: 'แสงสีร่วมสมัย',
          popup: { buttonText: 'ดูรายละเอียด', title: 'แสงสี', body: '...' },
        },
      ],
    },
    { type: 'page_break' },
    { type: 'text_question', title: 'ข้อเสนอแนะ' },
  ],
});

/** Skips review and publishing: opens the poll directly in the DB. */
const openInDb = (id: string) =>
  db.query(
    "UPDATE polls SET status = 'open', opened_at = now() WHERE id = $1",
    [id],
  );

describe('draft lifecycle', () => {
  let id: string;

  it('creates an empty draft', async () => {
    const res = await eng.post('/polls').send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      version: 1,
      isOwner: true,
      audience: { type: 'public' },
      elements: [],
      reviews: [],
    });
    id = res.body.id;
  });

  it('PUT needs a matching If-Match version', async () => {
    const missing = await eng.put(`/polls/${id}`).send(completeDraft());
    expect(missing.status).toBe(428);

    const stale = await eng
      .put(`/polls/${id}`)
      .set('If-Match', '"9"')
      .send(completeDraft());
    expect(stale.status).toBe(412);
    expect(stale.body).toMatchObject({
      code: 'VERSION_CONFLICT',
      currentVersion: 1,
    });
  });

  it('saves the whole draft in one PUT', async () => {
    const res = await eng
      .put(`/polls/${id}`)
      .set('If-Match', '"1"')
      .send(completeDraft());
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.elements.map((e: { type: string }) => e.type)).toEqual([
      'single_choice',
      'page_break',
      'text_question',
    ]);
    expect(res.body.elements[0].options[1]).toMatchObject({
      label: 'แสงสีร่วมสมัย',
      popup: { buttonText: 'ดูรายละเอียด' },
    });
    expect(res.body.elements[2].config).toEqual({ maxLength: 1000 });
    expect(res.body.audience.rules).toHaveLength(2);
  });

  it('rejects unknown faculties and images from outside our storage', async () => {
    const faculty = await eng
      .put(`/polls/${id}`)
      .set('If-Match', '2')
      .send({
        ...completeDraft(),
        audience: { type: 'restricted', rules: [{ facultyCode: '99' }] },
      });
    expect(faculty.status).toBe(422);
    expect(faculty.body).toMatchObject({
      code: 'UNKNOWN_FACULTY',
      facultyCodes: ['99'],
    });

    const image = await eng
      .put(`/polls/${id}`)
      .set('If-Match', '2')
      .send({
        ...completeDraft(),
        coverImageUrl: 'https://evil.example/tracker.png',
      });
    expect(image.status).toBe(422);
    expect(image.body.code).toBe('INVALID_IMAGE_URL');
    expect(image.body.problems[0].path).toBe('coverImageUrl');
  });

  it('other users cannot see or touch the draft', async () => {
    expect((await med.get(`/polls/${id}`)).status).toBe(404);
    expect(
      (await med.put(`/polls/${id}`).set('If-Match', '2').send({})).status,
    ).toBe(404);
    expect((await med.post(`/polls/${id}/submit`)).status).toBe(404);
  });

  it('submit locks the poll; a restricted poll skips review', async () => {
    const res = await eng.post(`/polls/${id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.submittedAt).toBeTruthy();

    const put = await eng
      .put(`/polls/${id}`)
      .set('If-Match', '2')
      .send(completeDraft());
    expect(put.status).toBe(409);
    expect(put.body.code).toBe('POLL_LOCKED');
    expect((await eng.delete(`/polls/${id}`)).status).toBe(409);

    const audit = await db.query(
      "SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'poll.submit'",
      [id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('only a Chula-wide poll waits for an admin', async () => {
    const chula = await eng
      .post('/polls')
      .send({ ...completeDraft(), audience: { type: 'chula' } });
    const res = await eng.post(`/polls/${chula.body.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_review');
  });

  it('admins can see a submitted poll, others still cannot', async () => {
    expect((await admin.get(`/polls/${id}`)).status).toBe(200);
    expect((await med.get(`/polls/${id}`)).status).toBe(404);
  });

  describe('once open', () => {
    beforeAll(() => openInDb(id));

    it('is visible to eligible users only', async () => {
      // med matches the studentYear=2566 rule; arts matches nothing
      const res = await med.get(`/polls/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        isOwner: false,
        myBallot: { submitted: false, canEdit: false },
        canViewResults: false,
      });
      expect(res.body.reviews).toBeUndefined();
      expect((await arts.get(`/polls/${id}`)).status).toBe(404);
    });

    it('shows up in the feed for eligible users', async () => {
      const medFeed = await med.get('/polls');
      expect(medFeed.body.items.map((p: { id: string }) => p.id)).toContain(id);
      const artsFeed = await arts.get('/polls');
      expect(
        artsFeed.body.items.map((p: { id: string }) => p.id),
      ).not.toContain(id);
    });

    it('owner can move closesAt, but not into the past', async () => {
      const past = await eng
        .patch(`/polls/${id}/closes-at`)
        .send({ closesAt: '2020-01-01T00:00:00Z' });
      expect(past.status).toBe(422);

      const later = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const ok = await eng
        .patch(`/polls/${id}/closes-at`)
        .send({ closesAt: later });
      expect(ok.status).toBe(200);
      expect(new Date(ok.body.closesAt).toISOString()).toBe(later);
    });

    it('the database refuses to change questions of an open poll', async () => {
      await expect(
        db.query("UPDATE poll_elements SET title = 'x' WHERE poll_id = $1", [
          id,
        ]),
      ).rejects.toThrow(/locked/);
    });

    it('only the owner can close it, once', async () => {
      expect((await med.post(`/polls/${id}/close`)).status).toBe(404);
      const res = await eng.post(`/polls/${id}/close`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'closed',
        canViewResults: true,
      });
      expect((await eng.post(`/polls/${id}/close`)).status).toBe(409);
    });
  });
});

describe('submit validation', () => {
  it('lists every problem with an incomplete draft', async () => {
    const { body } = await eng.post('/polls').send({
      elements: [{ type: 'single_choice', options: [{ label: 'a' }] }],
    });
    const res = await eng.post(`/polls/${body.id}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('POLL_INCOMPLETE');
    expect(res.body.problems.map((p: { path: string }) => p.path)).toEqual([
      'title',
      'closesAt',
      'elements.0.title',
      'elements.0.options',
    ]);
  });
});

describe('my polls', () => {
  it('pages with a cursor, newest first, no overlap', async () => {
    const created: string[] = [];
    for (const title of ['a', 'b', 'c']) {
      created.push((await arts.post('/polls').send({ title })).body.id);
      // distinct createdAt, so the expected order doesn't depend on id tie-breaks
      await new Promise((r) => setTimeout(r, 5));
    }
    const first = await arts.get('/me/polls?limit=2');
    expect(first.body.items.map((p: { title: string }) => p.title)).toEqual([
      'c',
      'b',
    ]);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await arts.get(
      `/me/polls?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items.map((p: { title: string }) => p.title)).toEqual([
      'a',
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('delete removes a draft', async () => {
    const { body } = await arts.post('/polls').send({ title: 'tmp' });
    expect((await arts.delete(`/polls/${body.id}`)).status).toBe(204);
    expect((await arts.get(`/polls/${body.id}`)).status).toBe(404);
  });
});

describe('half-done restricted audience', () => {
  it('saves without faculties, then submit says what is missing', async () => {
    const draft = {
      ...completeDraft(),
      audience: { type: 'restricted', rules: [] },
    };
    const created = await eng.post('/polls').send(draft);
    expect(created.status).toBe(201);
    expect(created.body.audience).toEqual({ type: 'restricted', rules: [] });

    const submit = await eng.post(`/polls/${created.body.id}/submit`);
    expect(submit.status).toBe(422);
    expect(submit.body.problems).toEqual([
      {
        path: 'audience.rules',
        message: 'ต้องเลือกคณะหรือปีเข้าอย่างน้อย 1 อย่าง',
      },
    ]);
  });

  it('saves blank options and empty blocks, then submit lists each one', async () => {
    const created = await eng.post('/polls').send({
      ...completeDraft(),
      elements: [
        {
          type: 'single_choice',
          title: 'เลือก',
          options: [
            { label: '' },
            { label: 'b', popup: { title: 'มีแต่หัวข้อ', body: '' } },
          ],
        },
        { type: 'image', config: { url: '' } },
        { type: 'info_popup', config: { title: '', body: '' } },
        { type: 'accordion', config: { title: 'หัวข้อ', body: '' } },
      ],
    });
    expect(created.status).toBe(201);

    const submit = await eng.post(`/polls/${created.body.id}/submit`);
    expect(submit.status).toBe(422);
    expect(submit.body.problems.map((p: { path: string }) => p.path)).toEqual([
      'elements.0.options.0.label',
      'elements.0.options.1.popup',
      'elements.1.config.url',
      'elements.2.config.title',
      'elements.2.config.body',
      'elements.3.config.body',
    ]);
  });

  it('words common schema errors plainly', async () => {
    const res = await eng.post('/polls').send({ title: 'ก'.repeat(201) });
    expect(res.status).toBe(422);
    expect(res.body.problems).toEqual([
      { path: 'title', message: 'ยาวเกิน 200 ตัวอักษร' },
    ]);
  });

  it('reports malformed fields as dot paths with Thai messages', async () => {
    const res = await eng.post('/polls').send({
      ...completeDraft(),
      audience: { type: 'restricted', rules: [{}] },
    });
    expect(res.status).toBe(422);
    expect(res.body.problems).toEqual([
      { path: 'audience.rules.0', message: 'ต้องระบุคณะหรือปีเข้า' },
    ]);
  });
});

describe('faculties', () => {
  it('lists every seeded faculty, not only ones seen from logins', async () => {
    const res = await eng.get('/faculties');
    expect(res.headers['cache-control']).toContain('s-maxage=3600');
    const codes = res.body.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['21', '24', '34', '40']));
    expect(res.body.find((f: { code: string }) => f.code === '21')).toEqual({
      code: '21',
      nameTh: 'คณะวิศวกรรมศาสตร์',
      nameEn: 'Faculty of Engineering',
    });
  });
});

describe('audience "chula"', () => {
  let id: string;

  beforeAll(async () => {
    const res = await eng
      .post('/polls')
      .send({ ...completeDraft(), audience: { type: 'chula' } });
    expect(res.body.audience).toEqual({ type: 'chula' });
    id = res.body.id;
    await openInDb(id);
  });

  it('any CUNEX-verified user may answer', async () => {
    expect((await arts.get(`/polls/${id}`)).status).toBe(200);
    const card = (await med.get('/polls')).body.items.find(
      (p: { id: string }) => p.id === id,
    );
    // list cards carry the number of questions (page breaks don't count)
    expect(card).toMatchObject({ audience: 'chula', questionCount: 2 });
  });

  it('an account not verified by CUNEX may not', async () => {
    // The guard re-reads the user on every request: turn arts into a
    // account that is not CUNEX-verified (no faculty/year).
    const me = await arts.get('/me');
    await db.query(
      'UPDATE users SET is_chula_verified = false, faculty_code = NULL, student_year = NULL WHERE id = $1',
      [me.body.id],
    );
    try {
      expect((await arts.get(`/polls/${id}`)).status).toBe(404);
      expect(
        (await arts.get('/polls')).body.items.map((p: { id: string }) => p.id),
      ).not.toContain(id);
    } finally {
      await loginAs(app, 'arts-2565'); // a CUNEX login re-verifies it
    }
  });
});

describe('content fields from the web app', () => {
  it('keeps imageAlt and popups without a button label', async () => {
    const res = await eng.post('/polls').send({
      title: 'ฟิลด์ใหม่',
      elements: [
        {
          type: 'single_choice',
          title: 'เลือก',
          options: [
            {
              label: 'a',
              imageAlt: 'คำอธิบายรูป',
              popup: { title: 'เพิ่มเติม', body: 'รายละเอียด' },
            },
            { label: 'b' },
          ],
        },
        {
          type: 'info_popup',
          config: { title: 'ก่อนตอบ', body: 'อ่านตรงนี้' },
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.elements[0].options[0]).toMatchObject({
      imageAlt: 'คำอธิบายรูป',
      popup: { title: 'เพิ่มเติม', body: 'รายละเอียด' },
    });
    expect(res.body.elements[1].config).toEqual({
      title: 'ก่อนตอบ',
      body: 'อ่านตรงนี้',
    });
  });
});

describe('page size', () => {
  it('a limit above the maximum is clamped, not rejected', async () => {
    const res = await eng.get('/me/polls?limit=1000');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });
});
