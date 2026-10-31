# ย้าย voting-frontend มาใช้ backend จริง (NestJS)

เอกสารนี้สำหรับทีม frontend ใช้แทน API ชั่วคราวใน `app/api/*` และ DB ใน `db/` ของ repo frontend

- รายละเอียด API ทุกตัวอยู่ที่ [api-endpoints.md](./api-endpoints.md) (ฉบับเต็ม ภาษาอังกฤษ) เอกสารนี้เน้นว่า **หน้าไหนต้องเรียกอะไร และต้องแปลงอะไรบ้าง**
- ตัวอย่าง JSON ทุกตัวในนี้ได้จากการยิง API จริง แค่ตัด field ซ้ำ ๆ ออก

---

## TL;DR — ต้องทำอะไรบ้าง

1. **ลบ `app/api/*`, `db/`, `docker-compose.yml`, `src/lib/db.ts`** ไม่ต้องใช้ Postgres ของตัวเองแล้ว
2. **ตั้ง rewrite** ให้ `/api/v1/*` ของเว็บวิ่งไป backend (ดู [ข้อ 1](#1-setup)) จะได้อยู่ origin เดียวกัน cookie ไปเอง ไม่ต้องยุ่ง CORS
3. **Auth:** ลบ `CURRENT_USER` ใช้ `GET /api/v1/me` แทน, ปุ่ม login ชี้ไป `/api/v1/auth/cunex/login` (login ด้วย CUNEX อย่างเดียว ไม่มี Google และ Email)
4. **แก้ทุกที่ที่อ่าน DB ตรง** (server component 18 ไฟล์ที่ import `@/lib/polls`, `@/lib/votes`, ฯลฯ) ให้เรียก API แทน
5. **แปลงชื่อ** สถานะ / ประเภทคำถาม / field ตาม [ข้อ 3](#3-ตารางแปลงชื่อ)
6. **ใช้ id จาก server** คำถามและตัวเลือกมี `id` (uuid) ที่ server สร้าง ตอนส่งคำตอบต้องใช้ id พวกนี้ ไม่ใช่ id ที่ frontend gen เอง
7. **Error** เป็น `application/problem+json` อ่าน `code` แล้วแปลเป็นข้อความไทยเอง (ดู [ข้อ 6](#6-error))
8. ฟีเจอร์ใน [ข้อ 7](#7-ยังไม่มีใน-backend) ยังไม่มีใน backend ให้ซ่อน UI ไว้ก่อน

---

## 1. Setup

### รัน backend ในเครื่อง

```bash
# ใน repo voting-backend
pnpm install
docker compose up -d        # postgres :55432, redis :6379, S3 (SeaweedFS) :8333
cp .env.example .env        # แล้วแก้ 3 ค่าตามด้านล่าง
pnpm db:migrate
pnpm start:dev              # API
pnpm start:worker           # worker (ปิดโพลตามเวลา, notification) เปิดอีก terminal
```

แก้ `.env` ของ backend ให้รู้จักเว็บ (Next ใช้ port 3000 เลยย้าย backend ไป 4000):

```env
PORT=4000
APP_ORIGIN=http://localhost:3000      # origin ของเว็บ
API_PUBLIC_URL=http://localhost:3000  # ผ่าน rewrite ของเว็บ (redirect ของ login กลับมาที่นี่)
```

### `next.config.ts`

```ts
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000'

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${BACKEND_URL}/api/v1/:path*` }]
  },
}
```

ทำไมต้อง rewrite: session เป็น cookie `sid` (httpOnly) ที่ backend ตั้ง ถ้าเว็บกับ API อยู่ origin เดียวกัน
browser ส่ง cookie ให้เองทุก request และ backend **ไม่ได้เปิด CORS** ไว้

### เรียก API จาก client component

```ts
const res = await fetch('/api/v1/polls/' + id)   // same-origin: cookie ไปเอง
```

POST/PUT/PATCH/DELETE: browser ใส่ header `Origin` ให้อยู่แล้ว backend เช็คว่าตรง `APP_ORIGIN` (กัน CSRF)
**ห้ามยิง non-GET จาก server ฝั่ง Next** (server action / route handler) เพราะจะไม่มี `Origin` ที่ถูกต้อง → `403 BAD_ORIGIN`
ให้ mutation ทั้งหมดยิงจาก client

### เรียก API จาก server component (GET เท่านั้น)

ต้องส่ง cookie ของผู้ใช้ต่อไปเอง และเรียก backend ตรง (ไม่ผ่าน rewrite):

```ts
import { cookies } from 'next/headers'

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${process.env.BACKEND_URL}/api/v1${path}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  })
  if (!res.ok) throw await res.json()   // problem+json
  return res.json()
}
```

### Login ตอน dev (ไม่มี CUNEX จริง)

backend ตั้ง `CUNEX_MODE=mock` ไว้ มีบัญชีทดลอง 4 คน เปิดลิงก์แล้วจะ login ทันที:

| ลิงก์ | คนที่ได้ |
|---|---|
| `/api/v1/auth/cunex/login?mockUser=eng-2567` | วิศวะ ปีเข้า 2567 (รหัส 6730000121) |
| `/api/v1/auth/cunex/login?mockUser=med-2566` | แพทย์ 2566 (6630000230) |
| `/api/v1/auth/cunex/login?mockUser=arts-2565` | อักษร 2565 (6530000322) |
| `/api/v1/auth/cunex/login?mockUser=admin` | วิทยาศาสตร์ 2564 (6430000923) **เป็นแอดมิน** |

หรือ `POST /api/v1/auth/dev/login` body `{ "role": "user" | "admin" }` (ใช้ได้เฉพาะตอน dev)

---

## 2. Auth

| ทำอะไร | เรียก |
|---|---|
| ปุ่ม "เข้าสู่ระบบด้วย CUNEX" | `window.location.href = '/api/v1/auth/cunex/login?returnTo=/explore'` |
| ปุ่ม Google / Email | **ไม่มี** login ด้วย CUNEX อย่างเดียว |
| ใครกำลัง login | `GET /api/v1/me` → `401 UNAUTHENTICATED` ถ้ายังไม่ login |
| ออกจากระบบ | `POST /api/v1/auth/logout` → `204` |

`returnTo` ต้องเป็น path ในเว็บ (`/...`) login เสร็จจะ redirect กลับมาที่นั่น

ถ้า login ไม่สำเร็จ backend จะ redirect มาที่ `/login?error=<เหตุผล>` ให้หน้า login อ่านแล้วโชว์ข้อความ:

| `error` | ข้อความแนะนำ |
|---|---|
| `token_expired` | ลิงก์เข้าสู่ระบบหมดอายุ กรุณาเปิดจาก CUNEX ใหม่อีกครั้ง |
| `cunex_unavailable` | เชื่อมต่อ CUNEX ไม่ได้ ลองใหม่อีกครั้ง |

```jsonc
// GET /api/v1/me
{
  "id": "9350db16-146f-4dc3-b627-c0464102cdc8",
  "role": "user",                 // "user" | "admin"
  "studentId": "6630000230",      // null สำหรับบัญชีที่ไม่ใช่นิสิต (เช่นบุคลากร)
  "isChulaVerified": true,        // login ด้วย CUNEX = true เสมอ
  "faculty": { "code": "30", "nameTh": "แพทยศาสตร์", "nameEn": "Faculty of Medicine" },
  "studentYear": 2566,            // ปีเข้า พ.ศ.
  "providers": ["cunex"]
}
```

- **ไม่มีชื่อผู้ใช้** CUNEX ไม่ส่งชื่อมา วงกลมตัวย่อ (ตอนนี้ "NA") ให้ใช้อย่างอื่น เช่นไอคอน หรือ 2 ตัวท้ายของรหัส
- `proxy.ts` ที่เช็ค cookie `token`/`role`: เปลี่ยนเป็นเช็คว่ามี cookie `sid` ไหม (ไม่มี → ไป `/login`)
  ส่วนเช็คว่าเป็นแอดมินไหม ให้ดูจาก `me.role` เพราะ cookie อ่านค่า role ไม่ได้

---

## 3. ตารางแปลงชื่อ

### สถานะโพล (`type` → `status`)

| frontend | backend | หมายเหตุ |
|---|---|---|
| `DRAFT` | `draft` | |
| `PENDING` | `pending_review` | |
| `APPROVED` | `approved` | รอเจ้าของกด Publish |
| `VOTING` | `open` | |
| `DONE` | `closed` | |
| `REJECTED` | `rejected` | แก้แล้วส่งใหม่ได้ |

### ขอบเขตผู้ตอบ (`scope` + `audience` → `audience`)

| frontend | backend |
|---|---|
| A ทั้งจุฬาฯ | `{ "type": "chula" }` คนที่ login ด้วย CUNEX ทุกคน |
| B เฉพาะคณะ | `{ "type": "restricted", "rules": [{ "facultyCode": "21" }, { "facultyCode": "21", "studentYear": 2567 }] }` |
| C สาธารณะ | `{ "type": "public" }` ทุกคนที่ login |
| D กำหนดจากรหัส | **ยังไม่มี** ([ข้อ 7](#7-ยังไม่มีใน-backend)) |

กฎของ `restricted`: แต่ละ rule เป็น "หรือ" กัน ใน rule เดียวกันต้องตรงทุกช่องที่ใส่
`{ facultyCode: "21" }` = วิศวะทุกปี · `{ studentYear: 2567 }` = ปีเข้า 2567 ทุกคณะ · ใส่ทั้งคู่ = วิศวะปี 2567

**ไม่มีสาขา** CUNEX ไม่ส่งข้อมูลสาขามา ให้เปลี่ยน FacultyPicker เป็น "คณะ + ปีเข้า"
รายชื่อคณะเอาจาก `GET /api/v1/faculties` แทน `mockFaculty.ts`

### ฟิลด์ของโพล

| frontend | backend |
|---|---|
| `desc` | `description` |
| `close` / `closeTime` | `closesAt` (ISO string) |
| `realtime` | `settings.showResultsRealtime` |
| `showExplore` | `settings.listedPublicly` |
| `question` (จำนวนคำถาม) | `questionCount` (ในรายการโพล) |
| `closedEarly`, `closeReason` | `closedEarly`, `closeReason` (ชื่อเดิม) |
| รูปปก (ยังไม่ได้บันทึก) | `coverImageUrl` |
| `allowRepeat` | ไม่มีตรงตัว ดู [ข้อ 7](#7-ยังไม่มีใน-backend) |
| `identifySender` | **ไม่มี** ดู [ข้อ 7](#7-ยังไม่มีใน-backend) |
| — | `settings.allowAnswerEdit` = ผู้ตอบแก้คำตอบตัวเองได้จนปิดโหวต |

### ประเภทคำถาม / องค์ประกอบ (`FormItem` → `elements[]`)

ไม่มี `kind` แล้ว ดูจาก `type` อย่างเดียว ลำดับใน array คือลำดับที่แสดง

| frontend | backend `type` | แปลงยังไง |
|---|---|---|
| input `radio` | `single_choice` | `label` → `title`, `required` → `isRequired`, `optionLayout` → `config.layout` |
| input `checkbox` | `multi_choice` | เหมือน radio และมี `config.minSelect` / `config.maxSelect` เพิ่มได้ |
| input `select` | `dropdown` | `config: {}` |
| input `text` | `text_question` | `config.placeholder`, `config.maxLength` (ค่าเริ่ม 1000) |
| element `text` | `description` | `config: { sections: [{ heading: title, body }] }` |
| element `image` | `image` | `config: { url, alt, caption }` |
| element `accordion` | `accordion` | `config: { title, body }` |
| element `dialog` | `info_popup` | `config: { buttonText: trigger, title, body, imageUrl }` |
| element `pagebreak` | `page_break` | `config: {}` |

ตัวเลือก (`Option`):

| frontend | backend |
|---|---|
| `label` | `label` |
| `imageUrl`, `imageAlt` | `imageUrl`, `imageAlt` |
| `info: { trigger, title, body }` | `popup: { buttonText, title, body }` (`buttonText` ไม่ใส่ก็ได้) |
| `id` | อย่าส่งไป server จะสร้าง `id` ให้เอง |

ข้อจำกัด: คำถามแบบเลือกต้องมี 2–50 ตัวเลือก (`dropdown` ได้ถึง 200), ทั้งโพลได้ไม่เกิน 200 element

---

## 4. หน้าไหนเรียกอะไร

ทุก path ด้านล่างขึ้นต้นด้วย `/api/v1`

### หน้าแรก "โพลของคุณ" (`/`)

`GET /me/polls?status=<status>&limit=20&cursor=<nextCursor>` (ไม่ใส่ `status` = ทุกสถานะ · `limit` สูงสุด 50 ขอเกินได้ 50)

แท็บ "พร้อมใช้งาน" รวมหลายสถานะ: เรียกครั้งเดียวไม่ใส่ `status` แล้วกรองฝั่ง client ก็ได้

### หน้า Explore (`/explore`)

`GET /polls?status=open|closed&limit=20&cursor=` โพลที่เปิดเผยในหน้ารวม (`listedPublicly`) **และผู้ใช้คนนี้มีสิทธิ์ตอบ**

```jsonc
{
  "items": [{
    "id": "b41b9266-ea8b-40a5-b2cc-1b8be46eb4e6",
    "status": "open",
    "title": "ธีมงานลอยกระทง",
    "description": "ช่วยกันเลือก",
    "coverImageUrl": null,
    "audience": "chula",               // ในรายการเป็นแค่ชื่อประเภท
    "closesAt": "2026-10-25T06:50:56.356Z",
    "openedAt": "2026-10-18T06:50:56.513Z",
    "closedAt": null,
    "closedEarly": false,
    "showResultsRealtime": true,
    "questionCount": 3,
    "createdAt": "2026-10-18T06:50:56.389Z",
    "myBallot": { "submitted": true, "canEdit": true }   // เฉพาะ GET /polls
  }],
  "nextCursor": null                     // ไม่ null = มีหน้าถัดไป ส่งกลับมาใน ?cursor=
}
```

### สร้าง / แก้ฉบับร่าง (`/create`, `/create/[id]`)

| ปุ่ม | เรียก |
|---|---|
| บันทึกฉบับร่าง (ครั้งแรก) | `POST /polls` body = PollDraft → `201` ได้ `id` กับ `version` |
| บันทึกฉบับร่าง (ครั้งต่อไป) | `PUT /polls/:id` + header `If-Match: <version>` body = PollDraft ทั้งก้อน |
| ส่งขออนุมัติ / ส่งโพล | บันทึกก่อน (POST/PUT) แล้ว `POST /polls/:id/submit` · ทั้งจุฬาฯ ได้ `pending_review` ขอบเขตอื่นได้ `approved` |
| ลบร่าง | `DELETE /polls/:id` |
| โหลดร่างมาแก้ | `GET /polls/:id` |
| อัปโหลดรูป | ดู [ข้อ 5](#5-อัปโหลดรูป) |

```jsonc
// PollDraft (ทุก field ไม่บังคับตอนบันทึกร่าง)
{
  "title": "ธีมงานลอยกระทง",
  "description": "ช่วยกันเลือก",
  "coverImageUrl": null,
  "closesAt": "2026-10-25T15:00:00.000Z",
  "audience": { "type": "chula" },
  "settings": { "showResultsRealtime": true, "allowAnswerEdit": true, "listedPublicly": true },
  "elements": [
    { "type": "description", "config": { "sections": [{ "heading": "ก่อนเริ่ม", "body": "อ่านก่อนนะ" }] } },
    { "type": "single_choice", "title": "ธีมหลัก", "isRequired": true, "config": { "layout": "list" },
      "options": [
        { "label": "ย้อนยุค" },
        { "label": "ร่วมสมัย", "popup": { "title": "คืออะไร", "body": "แสงสี" } }
      ] },
    { "type": "page_break" },
    { "type": "multi_choice", "title": "กิจกรรม", "config": { "maxSelect": 2 },
      "options": [{ "label": "ดนตรี" }, { "label": "อาหาร" }, { "label": "เกม" }] },
    { "type": "text_question", "title": "ข้อเสนอแนะ", "config": { "placeholder": "พิมพ์ได้เลย" } }
  ]
}
```

เรื่องที่ต้องรู้:

- ช่องที่ไม่บังคับ ส่ง `null` หรือไม่ส่งเลยก็ได้ ความหมายเดียวกัน
- **`PUT` ต้องส่ง `If-Match`** เป็น `version` ล่าสุดที่โหลดมา ไม่ส่ง → `428`, version เก่า (มีคนแก้จากอีกแท็บ) → `412 VERSION_CONFLICT` พร้อม `currentVersion` ให้โหลดใหม่หรือถามผู้ใช้
- **ทุกครั้งที่ `PUT` id ของคำถาม/ตัวเลือกจะเปลี่ยน** ใช้ `elements` จาก response ล่าสุดเสมอ
- **ตรวจความครบก่อนส่ง** `POST /polls/:id/submit` ถ้ายังไม่ครบได้ `422 POLL_INCOMPLETE` พร้อม `problems` ทุกข้อในครั้งเดียว
  `path` บอกตำแหน่ง เช่น `elements.2.options` ข้อความเป็นภาษาไทยแล้ว เอาไปโชว์ได้เลย
  ```jsonc
  { "code": "POLL_INCOMPLETE", "problems": [
      { "path": "closesAt", "message": "เวลาปิดโหวตต้องอยู่ในอนาคต" },
      { "path": "elements.1.options", "message": "ต้องมีตัวเลือกอย่างน้อย 2 ข้อ" } ] }
  ```
- เลือก "แบบรูปใหญ่" (`layout: "grid"`) แล้วต้องมีรูปครบทุกตัวเลือก ตอนนี้ frontend เช็คเองอยู่แล้ว **backend ยังไม่ได้เช็คข้อนี้**
- หลังส่งขออนุมัติ แก้เนื้อหาไม่ได้แล้ว (ถูกตีกลับ = `rejected` ถึงจะแก้และส่งใหม่ได้)

### หน้า Preview (`/create/preview`)

ใช้ข้อมูลใน store ของหน้า create เหมือนเดิม ไม่ต้องเรียก API

### Dashboard ของเจ้าของ (`/dashboard/[slug]`)

| ส่วน | เรียก |
|---|---|
| ข้อมูลโพล | `GET /polls/:id` |
| สวิตช์เรียลไทม์ | `PATCH /polls/:id/realtime` body `{ "showResultsRealtime": true }` แก้ได้ตอน `pending_review` / `approved` |
| ปุ่ม Publish (เปิดโหวต) | `POST /polls/:id/publish` ได้เฉพาะ `approved` ถ้าเลยเวลาปิดแล้ว → `422 CLOSES_AT_PASSED` ให้เลื่อนเวลาก่อน |
| เลื่อนเวลาปิด | `PATCH /polls/:id/closes-at` body `{ "closesAt": "..." }` (`pending_review`, `approved`, `open`) |
| ปิดรับคำตอบ | `POST /polls/:id/close` body `{ "reason": "..." }` (ไม่ใส่เหตุผลก็ได้ ≤ 500 ตัวอักษร) |
| แชร์ | ลิงก์ของเว็บเอง (`/<id>`) หรือ `shareUrl` (ลิงก์เปิดใน CUNEX สร้างหลัง Publish ไม่กี่วินาที) |
| สรุปผล | `GET /polls/:id/results` ดู [ผลโหวต](#ผลโหวต) |
| คำตอบข้อความ "ดูทั้งหมด" | `GET /polls/:id/results/text?elementId=<id>&limit=50&cursor=` → `{ items: [{ text }], nextCursor }` |
| เผยแพร่ผล | `PUT /polls/:id/result-display` ดู [ตั้งค่าเผยแพร่ผล](#ตั้งค่าเผยแพร่ผล-publish) |
| คำตอบรายชุด / ส่งออก CSV | **ยังไม่มี** ([ข้อ 7](#7-ยังไม่มีใน-backend)) |

`GET /polls/:id` (ตัวอย่างนี้เป็นมุมมองของผู้ตอบ):

```jsonc
{
  "id": "b41b9266-ea8b-40a5-b2cc-1b8be46eb4e6",
  "status": "open",
  "version": 1,
  "title": "ธีมงานลอยกระทง",
  "description": "ช่วยกันเลือก",
  "coverImageUrl": null,
  "closesAt": "2026-10-25T06:50:56.356Z",
  "submittedAt": "2026-10-18T06:50:56.469Z",
  "openedAt": "2026-10-18T06:50:56.513Z",
  "closedAt": null,
  "closedEarly": false,
  "closeReason": null,
  "takenDown": false,             // แอดมินถอดโพลนี้ · เหตุผลอยู่ใน takedownReason (เฉพาะเจ้าของ/แอดมิน)
  "createdAt": "2026-10-18T06:50:56.389Z",
  "updatedAt": "2026-10-18T06:50:56.513Z",
  "audience": { "type": "chula" },
  "settings": { "showResultsRealtime": true, "allowAnswerEdit": true, "listedPublicly": true },
  "resultDisplay": { "published": true, "elementIds": null, "views": ["list"],
                     "showCount": true, "showPercent": true, "showTotal": true },
  "shareUrl": null,
  "elements": [
    { "id": "319c55d8-…", "type": "description", "title": "", "isRequired": false,
      "config": { "sections": [{ "heading": "ก่อนเริ่ม", "body": "อ่านก่อนนะ" }], "showHeading": true } },
    { "id": "0b6e71ff-…", "type": "single_choice", "title": "ธีมหลัก", "isRequired": true,
      "config": { "layout": "list" },
      "options": [
        { "id": "513aab1c-…", "label": "ย้อนยุค", "description": null, "imageUrl": null, "imageAlt": null, "popup": null },
        { "id": "06b56197-…", "label": "ร่วมสมัย", "description": null, "imageUrl": null, "imageAlt": null,
          "popup": { "title": "คืออะไร", "body": "แสงสี" } }
      ] },
    { "id": "5f25a254-…", "type": "page_break", "title": "", "isRequired": false, "config": {} },
    { "id": "f0a0469c-…", "type": "text_question", "title": "ข้อเสนอแนะ", "isRequired": false,
      "config": { "maxLength": 1000, "placeholder": "พิมพ์ได้เลย" } }
  ],
  "isOwner": false,
  "myBallot": { "submitted": true, "canEdit": true },
  "canViewResults": true,
  "reviews": [ { "decision": "rejected", "comment": "…", "createdAt": "…" } ]   // เฉพาะเจ้าของ/แอดมิน
}
```

### หน้าตอบโพล (`/[slug]`, `/[slug]/q/[page]`, `/[slug]/done`, `/[slug]/my-answers`)

| ส่วน | เรียก |
|---|---|
| หน้าแนะนำ + คำถาม | `GET /polls/:id` แบ่งหน้าด้วย element `page_break` เหมือนเดิม |
| ส่งคำตอบ | `PUT /polls/:id/ballot` → `201` ครั้งแรก, `200` ตอนแก้ |
| "คำตอบของคุณ" / เติมคำตอบเดิมตอนแก้ | `GET /polls/:id/ballot` → `404 NO_BALLOT` ถ้ายังไม่เคยตอบ |
| ปุ่ม "ดูผล" | โชว์เมื่อ `canViewResults` เป็น `true` แล้วเรียก `GET /polls/:id/results` |

```jsonc
// PUT /polls/:id/ballot  (request; response เหมือนกัน + submittedAt)
{ "answers": [
    { "elementId": "0b6e71ff-…", "optionIds": ["06b56197-…"] },          // single_choice / dropdown: 1 ตัว
    { "elementId": "51ed5a95-…", "optionIds": ["cb080bef-…", "30e2b640-…"] },  // multi_choice
    { "elementId": "f0a0469c-…", "text": "อยากให้มีจุดแยกขยะ" }          // text_question
  ] }
// response: { "answers": [...], "submittedAt": "2026-10-18T06:50:00.000Z" }  (ปัดเป็นนาที)
```

- ข้อที่ไม่ตอบ ไม่ต้องส่ง (หรือส่ง `optionIds: []` / `text: ""` ก็ได้)
- `PUT` ซ้ำได้ปลอดภัย (ไม่ต้องมี `clientToken`) คนหนึ่งมีได้คำตอบเดียวต่อโพล ส่งซ้ำ = แทนที่ของเดิม
  ถ้าโพลไม่เปิดให้แก้ (`allowAnswerEdit: false`) ส่งครั้งที่สองได้ `409 ALREADY_VOTED`
- `myBallot.submitted` = เคยตอบแล้ว · `myBallot.canEdit` = ตอนนี้ยังแก้ได้
- โพลที่ผู้ใช้ไม่มีสิทธิ์ตอบ หรือยังไม่เปิด ได้ `404` (ไม่บอกว่ามีโพลนี้อยู่)
- ข้อที่ตอบผิดได้ `422 INVALID_ANSWERS` พร้อม `problems` (ข้อความไทย)
  ```jsonc
  { "code": "INVALID_ANSWERS", "problems": [
      { "path": "answers.0.optionIds", "message": "เลือกได้ 1–2 ข้อ" },
      { "path": "elements.0b6e71ff-…", "message": "ต้องตอบข้อนี้" } ] }
  ```
- **ปิดก่อนกำหนด:** `status: "closed"`, `closedEarly: true`, `closeReason` = เหตุผลที่เจ้าของใส่ (หรือ `null`)

### ผลโหวต

`GET /polls/:id/results` ใช้ได้ทั้งหน้า dashboard (เจ้าของ) และหน้า `/[slug]/results` (ผู้ตอบ)

```jsonc
{
  "totalBallots": 1,
  "elements": [
    { "elementId": "0b6e71ff-…", "type": "single_choice", "answered": 1,
      "options": [
        { "optionId": "513aab1c-…", "count": 0, "percent": 0,   "weight": 0 },
        { "optionId": "06b56197-…", "count": 1, "percent": 100, "weight": 1 } ] },
    { "elementId": "f0a0469c-…", "type": "text_question", "answered": 1 }   // เจ้าของ/แอดมินเท่านั้น
  ],
  "generatedAt": "2026-10-18T06:50:56.716Z"
}
```

- `elements` เรียงตามลำดับในโพล มีทุกตัวเลือก ตัวที่ไม่มีคนเลือกเป็น 0
- `percent` = % ของคนที่ตอบข้อนั้น (`answered`) ทศนิยม 1 ตำแหน่ง ใช้แทน `percentOf()` เดิมได้เลย
- `weight` = count ÷ ตัวเลือกที่ได้มากสุด (0–1) ใช้กำหนดความยาวแท่ง/ขนาดชิ้นโดนัท
- ชื่อคำถาม/ตัวเลือกไม่ได้อยู่ใน response นี้ ให้จับคู่ `elementId` / `optionId` กับ `GET /polls/:id`
- **หน้าเรียลไทม์:** ดึงซ้ำทุก 3–5 วิ ส่ง header `If-None-Match: <ETag ครั้งก่อน>` ถ้าไม่มีอะไรเปลี่ยนได้ `304` (ไม่มี body)
- เจ้าของ/แอดมินขอผลแยกกลุ่มได้: `?breakdown=faculty` หรือ `?breakdown=year`
  (กลุ่มที่มีคนน้อยกว่า 5 คนถูกรวมเป็น `other` หรือซ่อน กันการระบุตัวตน)

**ผู้ตอบเห็นผลเมื่อไหร่** (ตรงกับกติกาเดิมของ frontend):

```
resultDisplay.published  และ  ( ปิดโหวตแล้ว  หรือ  (เปิดเรียลไทม์ และ ผู้ใช้คนนี้ตอบแล้ว) )
```

ไม่เข้าเงื่อนไข → `403 RESULTS_HIDDEN` ให้ใช้ `canViewResults` ใน `GET /polls/:id` ตัดสินว่าจะโชว์ปุ่มหรือไม่

ผู้ตอบได้เฉพาะคำถามแบบเลือกที่เจ้าของเผยแพร่ และตัวเลขที่ซ่อนจะเป็น `null`:

```jsonc
// resultDisplay = { showCount: false, showTotal: false, elementIds: [ข้อ 1] } → ผู้ตอบได้
{ "totalBallots": null,
  "elements": [{ "elementId": "0b6e71ff-…", "type": "single_choice", "answered": null,
    "options": [
      { "optionId": "513aab1c-…", "count": null, "percent": 0,   "weight": 0 },
      { "optionId": "06b56197-…", "count": null, "percent": 100, "weight": 1 } ] }],
  "generatedAt": "…" }
```

### ตั้งค่าเผยแพร่ผล (`/dashboard/[slug]/publish`)

`PUT /polls/:id/result-display` (ตั้งได้เมื่อโพล `open` หรือ `closed`) → ได้ PollDetail กลับมา

```jsonc
{
  "published": true,               // false = ผู้ตอบไม่เห็นผลเลย
  "elementIds": null,              // id ของคำถามที่เผยแพร่ · null = ทุกข้อแบบเลือก
  "views": ["list", "pie", "bar"], // อย่างน้อย 1
  "showCount": true,
  "showPercent": true,
  "showTotal": true
}
```

ต่างจากเดิม: `questions` (position) → **`elementIds`** (id ของคำถาม) · ค่าเริ่มต้นเหมือน `DEFAULT_DISPLAY` เดิม

### หน้าแอดมิน (`/admin`, `/admin/[slug]`, `/admin/manage`)

| ส่วน | เรียก |
|---|---|
| แท็บ รออนุมัติ / อนุมัติแล้ว / ปฏิเสธ | `GET /admin/polls?status=pending_review` / `approved` / `rejected` (สถานะอื่นก็ได้: `open`, `closed`, …) |
| ดูรายละเอียด | `GET /polls/:id` (แอดมินเห็นทุกสถานะ) |
| อนุมัติ | `POST /admin/polls/:id/approve` → `approved` (เจ้าของกด Publish เอง) |
| ปฏิเสธ | `POST /admin/polls/:id/reject` body `{ "comment": "..." }` (ไม่ใส่ก็ได้) |
| ปิดโพลที่มีปัญหา | `POST /admin/polls/:id/takedown` body `{ "reason": "..." }` (บังคับ) |
| รายชื่อแอดมิน | `GET /admin/admins` |
| เพิ่มแอดมิน | `POST /admin/admins` body `{ "studentId": "6630000230" }` → รายชื่อใหม่ทั้งหมด |
| ถอดแอดมิน | `DELETE /admin/admins/:id` (**`id` ของ user** จากรายชื่อ ไม่ใช่รหัสนิสิต) |

```jsonc
// GET /admin/admins
[{ "id": "2a1e87dd-…", "studentId": "6430000923", "cunexUserId": "100000000000000099",
   "facultyCode": "23", "lastLoginAt": "2026-10-18T06:50:56.325Z" }]
```

- เพิ่มแอดมินได้เฉพาะคนที่เคย login ด้วย CUNEX แล้วอย่างน้อยครั้งเดียว ไม่งั้น `404 USER_NOT_FOUND`
  (ให้ขึ้นว่า "ยังไม่พบผู้ใช้นี้ ให้เขาเข้าสู่ระบบด้วย CUNEX ก่อน")
- ถอดตัวเองไม่ได้ → `409 CANNOT_REVOKE_SELF`
- หน้าแอดมินทั้งหมดได้ `403 FORBIDDEN` ถ้าไม่ใช่แอดมิน

---

## 5. อัปโหลดรูป

`src/lib/imageUpload.ts` เกือบใช้ได้เลย แก้ 3 จุด:

1. `NEXT_PUBLIC_IMAGE_PRESIGN_URL=/api/v1/images/uploads`
2. body เปลี่ยนชื่อ field: `{ "mimeType": blob.type, "byteSize": blob.size }` (เดิม `contentType` / `size`)
3. ตอน `PUT` ไปที่ `uploadUrl` ใช้ header จาก `uploadHeaders` ที่ได้กลับมา

```jsonc
// POST /api/v1/images/uploads  → 201
{
  "uploadUrl": "http://localhost:8333/pollcunex-images/images/11e65b30-….jpg?X-Amz-…",  // ใช้ได้ 10 นาที
  "uploadHeaders": { "Content-Type": "image/jpeg" },
  "publicUrl": "http://localhost:8333/pollcunex-images/images/11e65b30-….jpg",          // เก็บอันนี้ในโพล
  "expiresInSeconds": 600
}
```

- รับ `image/jpeg`, `image/png`, `image/webp` ไม่เกิน 5 MB (`422 IMAGE_TOO_LARGE`)
- ขนาดไฟล์และ Content-Type ที่ `PUT` ต้องตรงกับที่ขอไว้เป๊ะ (ขอหลังบีบอัดรูปแล้ว) ไม่งั้น S3 ปฏิเสธ
- เอา `publicUrl` ไปใส่ได้ 4 ที่: `coverImageUrl`, `image.config.url`, `info_popup.config.imageUrl`, `option.imageUrl`
- **ใส่ลิงก์รูปจากเว็บอื่นไม่ได้** และ data URL ก็ไม่ได้ (`422 INVALID_IMAGE_URL`) ต้องผ่านการอัปโหลดนี้เท่านั้น
- ขอได้ 30 ครั้ง/นาที/คน

---

## 6. Error

ทุก error เป็นรูปแบบเดียวกัน (`Content-Type: application/problem+json`):

```jsonc
{ "type": "about:blank", "title": "Conflict", "status": 409,
  "code": "POLL_LOCKED",              // ← ใช้ตัวนี้ตัดสินใจ
  "detail": "Poll is closed",         // ภาษาอังกฤษ ไว้ debug ไม่ต้องโชว์ผู้ใช้
  "pollStatus": "closed" }            // บาง code มี field เพิ่ม
```

| status | `code` | เกิดตอน | ข้อความแนะนำ |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | ยังไม่ login / session หมดอายุ | พาไป `/login?returnTo=…` |
| 403 | `FORBIDDEN` | ไม่ใช่แอดมิน | คุณไม่มีสิทธิ์เข้าหน้านี้ |
| 403 | `BAD_ORIGIN` | ยิง non-GET จาก server หรือ origin ผิด | (bug ฝั่งเรา) |
| 403 | `NOT_ELIGIBLE` | เจ้าของ/แอดมินที่ไม่อยู่ในกลุ่มผู้ตอบพยายามตอบ | คุณไม่อยู่ในกลุ่มผู้ตอบของโพลนี้ |
| 403 | `RESULTS_HIDDEN` | ยังดูผลไม่ได้ | ยังดูผลโหวตของโพลนี้ไม่ได้ |
| 404 | `POLL_NOT_FOUND` | ไม่มีโพล / ไม่มีสิทธิ์เห็น | ไม่พบโพล |
| 404 | `NO_BALLOT` | ยังไม่เคยตอบ | (ไม่ใช่ error ของผู้ใช้) |
| 404 | `USER_NOT_FOUND` | เพิ่มแอดมินที่ไม่เคย login | ยังไม่พบผู้ใช้นี้ ให้เข้าสู่ระบบด้วย CUNEX ก่อน |
| 409 | `POLL_LOCKED` | ทำสิ่งที่สถานะตอนนี้ไม่อนุญาต (`pollStatus` บอกสถานะ) | สถานะโพลเปลี่ยนไปแล้ว กรุณาโหลดใหม่ |
| 409 | `POLL_CLOSED` | ส่งคำตอบหลังปิด | โพลนี้ปิดรับคำตอบแล้ว |
| 409 | `ALREADY_VOTED` | ตอบซ้ำในโพลที่แก้ไม่ได้ | คุณส่งคำตอบโพลนี้ไปแล้ว |
| 409 | `CANNOT_REVOKE_SELF` | ถอดแอดมินตัวเอง | ถอดสิทธิ์ตัวเองไม่ได้ |
| 412 | `VERSION_CONFLICT` | ร่างถูกแก้จากที่อื่น (`currentVersion`) | ฉบับร่างถูกแก้จากที่อื่น โหลดใหม่ก่อนบันทึก |
| 428 | `PRECONDITION_REQUIRED` | `PUT /polls/:id` ไม่ส่ง `If-Match` | (bug ฝั่งเรา) |
| 422 | `UNPROCESSABLE` | body ผิดรูปแบบ (`problems`: `{ path, message }[]`, path คั่นด้วยจุด เช่น `elements.2.title`, message เป็นภาษาไทย) | ข้อมูลไม่ถูกต้อง |
| 422 | `POLL_INCOMPLETE` | ส่งขออนุมัติแต่ยังไม่ครบ (`problems`) | โชว์ `problems[].message` |
| 422 | `INVALID_ANSWERS` | คำตอบผิด (`problems`) | โชว์ `problems[].message` |
| 422 | `INVALID_IMAGE_URL` | รูปไม่ได้มาจากการอัปโหลด (`problems`) | ต้องอัปโหลดรูปผ่านระบบ |
| 422 | `UNKNOWN_FACULTY` | รหัสคณะไม่มีในระบบ (`facultyCodes`) | ไม่พบคณะที่เลือก |
| 422 | `CLOSES_AT_PASSED` | Publish/อนุมัติโพลที่เลยเวลาปิดแล้ว | เลยเวลาปิดโหวตแล้ว กรุณาเลื่อนเวลาปิดก่อน |
| 422 | `INVALID_CLOSES_AT` | เลื่อนเวลาปิดไปอดีต | เวลาปิดต้องอยู่ในอนาคต |
| 422 | `IMAGE_TOO_LARGE` | รูปเกิน 5 MB | รูปใหญ่เกิน 5 MB |
| 429 | `RATE_LIMITED` | ยิงถี่เกิน (header `Retry-After` = วินาที) | ทำรายการถี่เกินไป รอสักครู่ |

---

## 7. ยังไม่มีใน backend

ฟีเจอร์ด้านล่างขัดกับการออกแบบเรื่องความเป็นนิรนามของผู้ตอบ หรือยังไม่มีข้อมูลรองรับ **กำลังตัดสินใจอยู่**
ระหว่างนี้ให้ซ่อน UI หรือปิดสวิตช์ไว้

| ฟีเจอร์ใน frontend | สถานะ | ระหว่างนี้ |
|---|---|---|
| ระบุคนส่ง (`identifySender`) + export แบบมีรหัสผู้ตอบ | ไม่มี: backend ไม่เก็บว่าใครตอบอะไร (แม้แต่แอดมินก็ดูไม่ได้) | ซ่อนสวิตช์ |
| ลงคะแนนซ้ำ (`allowRepeat` = ส่งหลายครั้ง นับหลายเสียง) | ไม่มี: หนึ่งคนหนึ่งคำตอบ มีแค่ `allowAnswerEdit` (แก้คำตอบเดิม) | เปลี่ยนสวิตช์เป็น "แก้คำตอบได้" → `settings.allowAnswerEdit` |
| บันทึกคำตอบที่ยังไม่เสร็จที่ server (`PUT /my-response`) | ไม่มี | เก็บใน `localStorage` ของเครื่องแทน |
| ขอบเขต D "กำหนดจากรหัส" + preset รหัส (`/presets`) | ยังไม่มี | ซ่อนตัวเลือก D และหน้า presets |
| เลือกสาขา | ไม่มีข้อมูลจาก CUNEX | เปลี่ยนเป็นคณะ + ปีเข้า |
| คำตอบรายชุด (`/responses`) และส่งออก CSV (`/export`) | ยังไม่มี | ซ่อนแท็บ "คำตอบรายชุด" และปุ่มส่งออก |

ถ้ามีฟีเจอร์ไหนจำเป็นต้องใช้จริง คุยกับฝั่ง backend ก่อน จะได้หาทางที่ไม่ทำให้ระบุตัวผู้ตอบได้

---

## 8. แผนที่ API เดิม → ใหม่

| frontend เดิม (`/api/...`) | backend (`/api/v1/...`) |
|---|---|
| `GET /polls` | `GET /me/polls` (โพลของฉัน) · `GET /polls` (explore) · `GET /admin/polls` (แอดมิน) |
| `POST /polls` (`type: DRAFT`) | `POST /polls` |
| `POST /polls` (`type: PENDING`) | `POST /polls` แล้ว `POST /polls/:id/submit` |
| `PUT /polls/:id` (ร่าง / ส่งจากร่าง) | `PUT /polls/:id` (+`If-Match`) แล้ว `POST /polls/:id/submit` ถ้าจะส่ง |
| `GET /polls/:id` | `GET /polls/:id` |
| `PATCH /polls/:id` `{ realtime }` | `PATCH /polls/:id/realtime` `{ showResultsRealtime }` |
| `PATCH /polls/:id` `{ status: VOTING }` | `POST /polls/:id/publish` |
| `PATCH /polls/:id` `{ status: DONE, reason }` | `POST /polls/:id/close` `{ reason }` |
| `PATCH /polls/:id` `{ status: APPROVED }` | `POST /admin/polls/:id/approve` |
| `PATCH /polls/:id` `{ status: REJECTED }` | `POST /admin/polls/:id/reject` `{ comment? }` |
| `POST /polls/:id/votes` `{ answers, clientToken }` | `PUT /polls/:id/ballot` `{ answers }` |
| `PUT /polls/:id/my-response` | ไม่มี (ข้อ 7) |
| `GET /polls/:id/results` | `GET /polls/:id/results` |
| `GET /polls/:id/public-results` | `GET /polls/:id/results` (server กรองตามสิทธิ์ให้แล้ว) |
| `GET /polls/:id/answers/:position` | `GET /polls/:id/results/text?elementId=` |
| `PUT /polls/:id/result-display` | `PUT /polls/:id/result-display` (`questions` → `elementIds`) |
| `GET /polls/:id/responses` | ไม่มี (ข้อ 7) |
| `GET /polls/:id/export` | ไม่มี (ข้อ 7) |
| `GET/POST/PATCH/DELETE /presets` | ไม่มี (ข้อ 7) |
| `GET /admins` | `GET /admin/admins` |
| `POST /admins` `{ studentId }` | `POST /admin/admins` `{ studentId }` |
| `DELETE /admins/:studentId` | `DELETE /admin/admins/:userId` |
| — | `GET /me`, `GET /faculties`, `POST /images/uploads`, `GET /polls/:id/ballot` |
