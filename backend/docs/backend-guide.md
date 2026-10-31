# CUNEX Poll Backend

1. [Tech stack](#1-tech-stack)
2. [High-level architecture](#2-high-level-architecture)
3. [LLE](#3-lle-requests) / [API](#4-api)
4. [DB schema](#5-db-schema)

## 1. Tech stack

สรุปสั้นๆ : **NestJS 12 + TypeScript** เขียน API, **Postgres** เก็บข้อมูลจริง, **Redis** เก็บของชั่วคราว (cache, ตัวนับกันกดรัว, queue) ส่วน session อยู่ใน Postgres

| เรื่อง | ใช้อะไร | เวอร์ชัน |
| --- | --- | --- |
| Runtime | Node.js | 24 (ขั้นต่ำ 22.12) |
| ภาษา | TypeScript | 6 |
| Framework | NestJS + Express (แบบ ESM) | 12.1 |
| Validation | zod | 4 |
| Database | PostgreSQL | 16+ (เครื่อง dev ใช้ 18) |
| คุยกับ DB | Kysely + `pg` | 0.29 |
| Type ของ DB | kysely-codegen | 0.20 |
| Migration | สคริปต์เขียนเอง อ่านไฟล์ `.sql` | — |
| Cache / rate limit / queue | Redis + ioredis | Redis 8, ioredis 6 |
| งานเบื้องหลัง | BullMQ | 6 |
| Log | pino + nestjs-pino | pino 10 |
| Health check | @nestjs/terminus | 12 |
| Test | Vitest + supertest | Vitest 4 |
| Lint / format | oxlint + Prettier | — |
| Package manager | pnpm | 11 |
| Dev บนเครื่อง | Docker Compose (Postgres + Redis) | — |

## 2. High-level architecture

สรุปสั้นๆ : ทุก request วิ่งเข้า **API ชุดเดียว** (NestJS ก้อนเดียว แบ่งเป็น 5 module) งานที่ช้าหรือต้องรอเวลาโยนให้ **Worker** ผ่านคิวใน Redis และข้อมูลจริงมีที่เดียวคือ **Postgres**

```mermaid
flowchart TB
    cunexApp["CUNEX app (webview)<br/>เมนู · notification · ลิงก์แชร์"]
    web["เว็บเปิดตรง<br/>login CUNEX"]
    lb["Load balancer + CDN<br/>TLS · WAF · rate limit · static · รูปภาพ"]
    subgraph api["API — NestJS · stateless รันอย่างน้อย 2 ตัว"]
        auth["Auth<br/>แลก token · session"]
        poll["Poll<br/>สร้าง/แก้ร่าง · สถานะ"]
        ballot["Ballot<br/>รับคำตอบ · ไม่เก็บ user_id"]
        result["Result<br/>นับผล · cache 3 วิ"]
        admin["Admin<br/>อนุมัติ · audit log"]
    end
    pg[("Postgres<br/>ข้อมูลจริง ผ่าน PgBouncer")]
    redis[("Redis<br/>cache · rate limit · คิวงาน")]
    s3[("Object storage<br/>รูปภาพ (S3)")]
    worker["Worker (โค้ดชุดเดียวกับ API)<br/>แจ้งเตือน · ปิดโพล · ดึงรูป"]
    lle["CUNEX LLE API<br/>/profile · /notification · /create_link"]

    cunexApp --> lb
    web --> lb
    lb --> api
    api --> pg
    api --> redis
    api --> s3
    redis --> worker
    worker --> lle
    auth -- "/profile" --> lle
```

## 3. LLE Requests

| LLE endpoint | ใช้ตอนไหน | คนเรียก |
| --- | --- | --- |
| `GET /profile?token=` | ตอน login: แลก token เป็น `userId`, `facultyCode`, `studentYear` | Auth module |
| `POST /notification` | ตอนโพลเปิด แจ้งคนที่อยู่ในขอบเขตผู้ตอบ | Worker |
| `POST /create_link` | ตอนโพลเปิด สร้างลิงก์แชร์ที่เปิดแอป CUNEX | Worker |

Gateway ที่ใช้งานได้จริง: `https://culab-svc.azurewebsites.net/Service.svc` (header `ClientId`, `ClientSecret`)

`/profile` ของจริงไม่ตรงกับ docs ของ LLE:

| docs บอก | ของจริง | เราทำยังไง |
| --- | --- | --- |
| `studentId` | `refId` | เก็บเป็นรหัสนิสิต (เฉพาะแบบ 10 หลัก) |
| ไม่มี | `userType`, ชื่อ-นามสกุล, คำนำหน้า, `email` | **ไม่เก็บ** เก็บเท่าที่จำเป็น |
| token ผิด → 417 `E002` | token ผิด → `204` ไม่มี body | ถือว่า token หมดอายุ |
| ClientId/Secret ผิด | `401` ไม่มี body | ถือว่า CUNEX ใช้ไม่ได้ |

บุคลากรอาจไม่มีคณะหรือปีเข้า ระบบรับได้ (ค่าเป็น null) แต่จะตอบได้แค่โพลแบบ "ทั้งจุฬาฯ" และ "สาธารณะ"

## 4. API

### Auth

| Method | Path | ใครเรียก | ทำอะไร |
| --- | --- | --- | --- |
| GET | `/auth/cunex/login` | ทุกคน | พาไปหน้า login ของ CUNEX |
| GET | `/auth/cunex/callback?token=` | ทุกคน | แลก token กับ `/profile` สร้าง session แล้ว redirect ไป URL ที่ไม่มี token |
| POST | `/auth/logout` | คนที่ login | ออกจากระบบ |
| POST | `/auth/dev/login` | เฉพาะ dev/staging | ป็อปอัป "เลือกบัญชีทดลอง" |
| GET | `/me` | คนที่ login | ข้อมูลตัวเอง (role, คณะ, ปีเข้า) |

### ดูโพล

| Method | Path | ใครเรียก | ทำอะไร |
| --- | --- | --- | --- |
| GET | `/faculties` | คนที่ login | รายชื่อคณะ ใช้ตอนเลือกขอบเขตผู้ตอบ |
| GET | `/polls` | คนที่ login | หน้ารวมโพล (เฉพาะโพลที่เรามีสิทธิ์ตอบ) |
| GET | `/me/polls` | คนที่ login | โพลที่ฉันสร้าง |
| GET | `/polls/:id` | คนที่ login | รายละเอียดโพล + ฉันตอบไปแล้วหรือยัง |

### สร้างและจัดการโพล (เจ้าของ)

| Method | Path | ทำอะไร |
| --- | --- | --- |
| POST | `/polls` | สร้างร่างใหม่ |
| PUT | `/polls/:id` | บันทึกร่าง**ทั้งก้อนทีเดียว** (ตั้งค่า + ขอบเขต + element ทุกตัวตามลำดับ) |
| DELETE | `/polls/:id` | ลบร่าง |
| POST | `/polls/:id/submit` | ส่งโพล: ทั้งจุฬาฯ → `pending_review` รอ admin · สาธารณะ/เฉพาะคณะ → `approved` ทันที |
| PATCH | `/polls/:id/closes-at` | เลื่อนเวลาปิด |
| PATCH | `/polls/:id/realtime` | เปิด/ปิดผลเรียลไทม์ (ได้จนกว่าจะเปิดโหวต) |
| POST | `/polls/:id/publish` | เปิดโหวต (Publish) หลัง admin อนุมัติ |
| PUT | `/polls/:id/result-display` | ตั้งค่าเผยแพร่ผลให้ผู้ตอบ |
| POST | `/polls/:id/close` | ปิดก่อนกำหนด (ใส่เหตุผลได้) |

สถานะโพล: `draft → pending_review → approved → open → closed` (ตีกลับ = `rejected` แก้แล้วส่งใหม่ได้) · เฉพาะโพลทั้งจุฬาฯ ที่ผ่าน `pending_review` ขอบเขตอื่นส่งแล้วเป็น `approved` เลย

### รูปภาพ

| Method | Path | ทำอะไร |
| --- | --- | --- |
| POST | `/images/uploads` | ขอ presigned URL แล้ว client อัปโหลดตรงไป storage เอง ได้ `publicUrl` ไปใส่ในโพล |

### ตอบโพล

| Method | Path | ทำอะไร |
| --- | --- | --- |
| GET | `/polls/:id/ballot` | ดึงคำตอบเดิมของฉัน (ไว้เติมตอนแก้) |
| PUT | `/polls/:id/ballot` | ส่งคำตอบครั้งแรก หรือแก้คำตอบ |

Error ที่ต้องรองรับตอนตอบโพล:

| status | code | เกิดตอน |
| --- | --- | --- |
| 404 | `POLL_NOT_FOUND` | ไม่เห็นโพลนี้ |
| 403 | `NOT_ELIGIBLE` | คณะ/ปีไม่ตรงขอบเขต |
| 409 | `POLL_CLOSED` | โพลปิดแล้วหรือเลยเวลา |
| 409 | `ALREADY_VOTED` | ตอบแล้ว และโพลไม่เปิดให้แก้ |
| 422 | `INVALID_ANSWERS` | ตอบไม่ครบ หรือเลือกตัวเลือกที่ไม่มี |

### ดูผล

| Method | Path | ใครเรียก | ทำอะไร |
| --- | --- | --- | --- |
| GET | `/polls/:id/results?breakdown=` | เจ้าของ, admin, ผู้ตอบ (ตามที่เจ้าของเผยแพร่) | นับผล เจ้าของ/admin แยกตามคณะหรือปีได้ cache 3 วินาที |
| GET | `/polls/:id/results/text` | เจ้าของ, admin | คำตอบแบบข้อความ |

### Admin

| Method | Path | ทำอะไร |
| --- | --- | --- |
| GET | `/admin/polls?status=pending_review` | คิวรออนุมัติ |
| POST | `/admin/polls/:id/approve` | อนุมัติ → `approved` รอเจ้าของกด Publish (ตอนนั้น worker ค่อยส่ง notification + สร้างลิงก์) |
| POST | `/admin/polls/:id/reject` | ตีกลับ (เหตุผลใส่หรือไม่ใส่ก็ได้) |
| POST | `/admin/polls/:id/takedown` | บังคับปิดโพลที่มีปัญหา |
| GET / POST / DELETE | `/admin/admins` | ดู / เพิ่ม (ด้วยรหัสนิสิต) / ถอด admin |
| GET | `/admin/audit-logs` | ดูประวัติการกระทำของ admin |

## 5. DB schema

```mermaid
erDiagram
    users ||--o{ user_identities : "user_id"
    faculties ||--o{ users : "faculty_code"
    users ||--o{ polls : "owner_id"
    polls ||--o{ poll_audience_rules : "poll_id"
    faculties ||--o{ poll_audience_rules : "faculty_code"
    polls ||--o{ poll_reviews : "poll_id"
    users ||--o{ poll_reviews : "reviewer_id"
    polls ||--o{ poll_elements : "poll_id"
    poll_elements ||--o{ element_options : "element_id"
    polls ||--o{ ballots : "poll_id"
    faculties ||--o{ ballots : "faculty_code"
    ballots ||--o{ ballot_choices : "ballot_id"
    element_options ||--o{ ballot_choices : "option_id"
    ballots ||--o{ ballot_text_answers : "ballot_id"
    poll_elements ||--o{ ballot_text_answers : "element_id"
    polls ||--o{ notification_batches : "poll_id"
    users ||--o{ audit_logs : "actor_id"

    users {
        uuid id PK
        enum role
        text student_id
        bool is_chula_verified
        char faculty_code FK
        int2 student_year
        timestamp created_at
        timestamp last_login_at
    }
    user_identities {
        uuid id PK
        uuid user_id FK
        enum provider
        text provider_subject
        text email
        timestamp created_at
    }
    faculties {
        char code PK
        text name_th
        text name_en
        timestamp updated_at
    }
    polls {
        uuid id PK
        uuid owner_id FK
        enum status
        enum audience
        text title
        text description
        text cover_image_url
        timestamp closes_at
        bool show_results_realtime
        bool allow_answer_edit
        bool listed_publicly
        jsonb result_display
        text share_url
        int version
        timestamp submitted_at
        timestamp opened_at
        timestamp closed_at
        text close_reason
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    poll_audience_rules {
        uuid id PK
        uuid poll_id FK
        char faculty_code FK
        int2 student_year
    }
    poll_reviews {
        uuid id PK
        uuid poll_id FK
        uuid reviewer_id FK
        enum decision
        text comment
        timestamp created_at
    }
    poll_elements {
        uuid id PK
        uuid poll_id FK
        int position
        enum type
        text title
        bool is_required
        jsonb config
    }
    element_options {
        uuid id PK
        uuid element_id FK
        int position
        text label
        text description
        text image_url
        text image_alt
        jsonb popup
    }
    ballots {
        uuid id PK
        uuid poll_id FK
        bytea voter_key "HMAC, ไม่มี user_id"
        char faculty_code FK
        int2 student_year
        timestamp submitted_at
    }
    ballot_choices {
        uuid ballot_id PK, FK
        uuid poll_id FK
        uuid element_id FK
        uuid option_id PK, FK
    }
    ballot_text_answers {
        uuid ballot_id PK, FK
        uuid poll_id FK
        uuid element_id PK, FK
        text answer
    }
    notification_batches {
        uuid id PK
        uuid poll_id FK
        text kind
        int total
        int succeeded
        int failed
        timestamp created_at
        timestamp finished_at
    }
    audit_logs {
        bigint id PK
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb data
        timestamp created_at
    }
```

ไฟล์จริง: [db/migrations/](../db/migrations/) (เริ่มที่ `0001_init.sql` แล้วไล่ตามเลข)

