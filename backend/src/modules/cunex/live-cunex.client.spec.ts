import { AppError } from '../../common/errors.js';
import { LiveCunexClient } from './live-cunex.client.js';

const client = new LiveCunexClient({
  gatewayUrl: 'https://gateway.example/lle',
  loginUrl: 'https://cunex.example/login',
  clientId: 'id-123',
  clientSecret: 'secret-456',
});

function respond(status: number, body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('LiveCunexClient.getProfile', () => {
  it('calls /profile with the token and client credentials', async () => {
    const fetchMock = respond(200, {
      userId: '100000000000000001',
      studentId: '6700000021',
      facultyCode: '21',
      facultyNameTH: 'วิศวกรรมศาสตร์',
      facultyNameEN: 'Faculty of Engineering',
      studentYear: '2567',
    });

    const profile = await client.getProfile('tok en');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://gateway.example/lle/profile?token=tok+en',
    );
    expect(init.headers).toMatchObject({
      ClientId: 'id-123',
      ClientSecret: 'secret-456',
    });
    expect(profile).toEqual({
      userId: '100000000000000001',
      studentId: '6700000021',
      staffId: null,
      facultyCode: '21',
      facultyNameTh: 'วิศวกรรมศาสตร์',
      facultyNameEn: 'Faculty of Engineering',
      studentYear: 2567,
    });
  });

  it('reads the live gateway shape: refId, extra fields ignored', async () => {
    respond(200, {
      email: null,
      facultyCode: '21',
      facultyNameEN: 'FACULTY OF ENGINEERING',
      facultyNameTH: 'คณะวิศวกรรมศาสตร์',
      firstNameEN: 'Somchai',
      firstNameTH: 'สมชาย',
      lastNameEN: 'Jaidee',
      lastNameTH: 'ใจดี',
      refId: '6800000021',
      studentYear: '2568',
      titleNameEN: 'MISTER',
      titleNameTH: 'นาย',
      userId: '100000000000000042',
      userType: 'STUDENT',
    });
    // names, title and email are not kept
    await expect(client.getProfile('t')).resolves.toEqual({
      userId: '100000000000000042',
      studentId: '6800000021',
      staffId: null,
      facultyCode: '21',
      facultyNameTh: 'คณะวิศวกรรมศาสตร์',
      facultyNameEn: 'FACULTY OF ENGINEERING',
      studentYear: 2568,
    });
  });

  it('keeps a staff id; accepts accounts without faculty or entry year', async () => {
    respond(200, { userId: '9', refId: '12345678', userType: 'STAFF' });
    await expect(client.getProfile('t')).resolves.toEqual({
      userId: '9',
      studentId: null,
      staffId: '12345678',
      facultyCode: null,
      facultyNameTh: '',
      facultyNameEn: '',
      studentYear: null,
    });
  });

  it('maps 204 (unknown or used token) to CUNEX_TOKEN_INVALID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(client.getProfile('t')).rejects.toMatchObject({
      code: 'CUNEX_TOKEN_INVALID',
    });
  });

  it('maps E002 (token expired) to CUNEX_TOKEN_INVALID', async () => {
    respond(417, { errorCode: 'E002', message: 'token expired' });
    await expect(client.getProfile('t')).rejects.toMatchObject({
      code: 'CUNEX_TOKEN_INVALID',
    });
  });

  it('treats other failures as CUNEX being unavailable', async () => {
    respond(417, { errorCode: 'E099', message: 'internal server error' });
    await expect(client.getProfile('t')).rejects.toMatchObject({
      code: 'CUNEX_UNAVAILABLE',
    });

    respond(200, { facultyCode: '21' });
    await expect(client.getProfile('t')).rejects.toBeInstanceOf(AppError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(client.getProfile('t')).rejects.toMatchObject({
      code: 'CUNEX_UNAVAILABLE',
    });
  });
});

describe('LiveCunexClient worker calls', () => {
  it('create_link posts the callback URL and returns shareUrl', async () => {
    const fetchMock = respond(200, {
      status: 'success',
      shareUrl: 'https://cunex.page.link/MjWT',
      created: '2024/08/30 08:30:00',
    });
    await expect(
      client.createShareLink('https://api.example/cb?returnTo=%2Fpolls%2F1'),
    ).resolves.toBe('https://cunex.page.link/MjWT');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://gateway.example/lle/create_link');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      callbackUrl: 'https://api.example/cb?returnTo=%2Fpolls%2F1',
    });
  });

  it('notification maps fields to LLE names and returns the summary', async () => {
    const fetchMock = respond(200, {
      summarySuccess: 1,
      summaryFailed: 1,
      data: [],
    });
    await expect(
      client.sendNotifications([
        {
          userId: '1',
          textTh: 'สวัสดี',
          textEn: 'hello',
          callbackUrl: 'https://x',
        },
        { userId: '2', textTh: 'สวัสดี' },
      ]),
    ).resolves.toEqual({ succeeded: 1, failed: 1 });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      data: [
        {
          userId: '1',
          text_TH: 'สวัสดี',
          text_EN: 'hello',
          callbackUrl: 'https://x',
        },
        { userId: '2', text_TH: 'สวัสดี' },
      ],
    });
  });

  it('throws on an error status so the job is retried', async () => {
    respond(417, {
      status: 'failed',
      errorCode: 'E006',
      message: 'Quota exceeded',
    });
    await expect(client.createShareLink('https://x')).rejects.toThrow(/417/);
  });
});
