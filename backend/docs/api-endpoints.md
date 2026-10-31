# CUNEX Poll — API endpoints (v1)

Base path: `/api/v1` · JSON in/out · times are ISO-8601 UTC.

## Conventions

| Topic | Rule |
|---|---|
| Auth | Session in an httpOnly, `Secure`, `SameSite=Lax` cookie (`sid`), stored in Postgres (`sessions`, SHA-256 of the cookie value, expires after `SESSION_TTL_SECONDS`). No bearer tokens. |
| CSRF | All non-GET requests must send `Origin` matching the app origin (checked server-side). |
| Errors | `application/problem+json` (RFC 9457): `{ type, title, status, detail, code }`. `code` is a stable machine id, e.g. `POLL_LOCKED`. |
| Pagination | Cursor based: `?limit=20&cursor=<opaque>` → `{ items, nextCursor }`. A `limit` above the endpoint's maximum (50 for `/polls`, `/me/polls`; 100 for admin lists and text answers) is clamped, not rejected. |
| Optional fields | In request bodies, `null` and a missing key both mean "not set". |
| Concurrency | Draft saves send `If-Match: <version>`; stale versions return `412 VERSION_CONFLICT`. |
| Rate limits | Per user in Redis: ballots 20/min, image uploads 30/min. `429` with `Retry-After`. |
| Visibility | A poll that the caller may not see returns `404` (not `403`), so poll ids can't be probed. |

Roles: **anon** (no session) · **user** (any login) · **verified** (logged in via CUNEX at least once) · **owner** (created the poll) · **admin**.

---

## 1. Auth & session

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/auth/cunex/login?returnTo=` | anon | 302 to the CUNEX "login with CUNEX" page. |
| GET | `/auth/cunex/callback?token=&returnTo=` | anon | Exchange CUNEX token via `/profile`, upsert user + faculty, create session, **302 to `returnTo` without the token**. Also the entry URL CUNEX opens from its menu, notifications and UniversalLinks. |
| POST | `/auth/logout` | user | Delete session → `204`. |
| POST | `/auth/dev/login` | anon | `{ role: "user" \| "admin" }` → test accounts popup. **Only mounted when `APP_ENV != production`.** |
| GET | `/me` | user | `Me` |

`returnTo` must be a relative path (`/polls/…`); anything else falls back to `/`.

Login is **CUNEX only** (no Google, no email/OTP). CUNEX callback errors
redirect to `<app>/login?error=token_expired|cunex_unavailable`.

```jsonc
// Me
{ "id": "uuid", "role": "user", "studentId": "6730000121", "isChulaVerified": true,
  "faculty": { "code": "21", "nameTh": "วิศวกรรมศาสตร์", "nameEn": "Engineering" },
  "studentYear": 2567, "providers": ["cunex"] }
```

## 2. Reference data

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/faculties` | user | All faculties (for the audience picker). Cached. |

## 3. Polls — browse

Lifecycle (`status`):

```
draft ──submit──► pending_review ──approve (admin)──► approved ──publish (owner)──► open ──► closed
  │ ▲                   │                                ▲           (at closesAt, or closed early)
  │ └── rejected ◄──────┘  (editable, can be resubmitted)│
  └──submit (audience public / restricted)───────────────┘
```

Only `audience.type = "chula"` goes through admin review. `public` and `restricted` polls go from `submit` straight to `approved`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/polls?status=open\|closed&cursor=` | user | The "หน้ารวม" feed: polls with `listedPublicly=true` that the caller is eligible for. Includes `myBallot` status per item. |
| GET | `/me/polls?status=&cursor=` | user | Polls I created, any status. |
| GET | `/polls/:pollId` | user | Poll detail. Voters see open/closed polls they are eligible for; owner and admins see every status. `reviews` history only for owner/admin. |

```jsonc
// PollDetail
{ "id": "uuid", "status": "open", "version": 7,
  "title": "…", "description": "…", "coverImageUrl": "https://…/images/<uuid>.png",
  "opensAt": null, "closesAt": "2026-10-20T10:00:00Z", "submittedAt": "…", "openedAt": "…", "closedAt": null,
  "closedEarly": false, "closeReason": null,   // set when the owner closed it before closesAt
  "takenDown": false,                          // an admin took it down (see §8)
  "audience": { "type": "restricted", "rules": [{ "facultyCode": "21", "studentYear": null }] },
             // or { "type": "public" } | { "type": "chula" }
  "settings": { "showResultsRealtime": false, "allowAnswerEdit": true, "listedPublicly": true },
  "resultDisplay": { "published": true, "elementIds": null, "views": ["list"],
                     "showCount": true, "showPercent": true, "showTotal": true },
  "shareUrl": "https://cunex.page.link/…",
  "elements": [ /* Element[], ordered */ ],
  "myBallot": { "submitted": true, "canEdit": true },
  "canViewResults": false,
  "isOwner": false,
  "reviews": [{ "decision": "rejected", "comment": "…", "createdAt": "…" }],  // owner/admin only
  "takedownReason": null }                                                    // owner/admin only
```

Lists return `{ items: PollSummary[], nextCursor }`. `PollSummary` = `id, status, title,
description, coverImageUrl, audience` (the type only: `"public" | "chula" | "restricted"`),
`opensAt, closesAt, openedAt, closedAt, closedEarly, showResultsRealtime, questionCount, createdAt`;
the feed adds `myBallot`.

Audiences: `public` = anyone logged in · `chula` = any CUNEX-verified user ·
`restricted` = CUNEX-verified users matching a faculty / entry-year rule.

## 4. Polls — authoring (owner)

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/polls` | user | Create a draft. Body = `PollDraft` (all fields optional). → `201 PollDetail` |
| PUT | `/polls/:pollId` | owner | Replace the whole draft (settings + audience + ordered elements + options) in one transaction. Only in `draft`/`rejected`. Needs `If-Match: <version>` (`428` if missing, `412 VERSION_CONFLICT` + `currentVersion` if stale). → `200 PollDetail` |
| DELETE | `/polls/:pollId` | owner | Soft delete. Only `draft`/`rejected`. → `204` |
| POST | `/polls/:pollId/submit` | owner | Validate completeness → `pending_review` (audience `chula`) or `approved` (`public` / `restricted`, no admin review). `422 POLL_INCOMPLETE` with `problems: [{ path, message }]` listing every problem. |
| PATCH | `/polls/:pollId/closes-at` | owner | `{ closesAt }` in `pending_review`, `approved` or `open`. Must be in the future and after `opensAt`. |
| PATCH | `/polls/:pollId/realtime` | owner | `{ showResultsRealtime }`. Only before voting starts (`pending_review`, `approved`). |
| GET | `/polls/:pollId/preview` | **public** | Intro card of a published (`open`/`closed`) poll for a shared link opened without logging in: title, description, cover, times, audience, `questionCount`. No questions, results or viewer data. `404` for unpublished, taken-down or missing polls. `GET /faculties` is public too. |
| POST | `/polls/:pollId/publish` | owner | "Publish": `approved` → `open`. Queues `poll-opened` (UniversalLink + notifications) and a delayed `close-poll` at `closesAt`. `422 CLOSES_AT_PASSED` if the deadline already went by (move it first). With a future `opensAt` the poll is `open` (listed) right away, but ballots are refused until then; `openedAt` = `opensAt` and `poll-opened` is delayed to it. Body optional, at most one of: `{ now: true }` opens right away (skips a saved schedule); `{ opensAt }` opens at this new time (future, before `closesAt`, else `422 INVALID_OPENS_AT` with `problems[path=opensAt]`); `{}` uses the saved `opensAt` if still ahead, otherwise opens now. `opensAt` and `openedAt` are always set to the actual opening time. |
| PUT | `/polls/:pollId/result-display` | owner | "เผยแพร่ผล": `ResultDisplay` (see §7). Only in `open` / `closed`. |
| POST | `/polls/:pollId/close` | owner | Close early → `closed`. Only from `open`. Body optional: `{ reason? }` (≤ 500 chars), shown to voters as `closeReason`. |

The Preview mode screen uses `GET /polls/:pollId`, which returns any status to the owner.

Notes:
- Element and option ids are regenerated on every `PUT` (drafts have no ballots yet); don't cache them across saves.
- `422 UNKNOWN_FACULTY` (`facultyCodes`) when an audience rule names a faculty not in `GET /faculties`.
- `422 INVALID_IMAGE_URL` (`problems`) when an image URL is not from `POST /images/uploads`.
- Wrong status for the action → `409 POLL_LOCKED` with `pollStatus`.

**Why one `PUT` for the whole draft, not per-element CRUD:** the editor is a single form saved with "บันทึกฉบับร่าง". Reorder ("swipe"), add and remove all happen client-side, and one transactional replace avoids partially saved drafts and position conflicts. Drafts are small (tens of elements).

```jsonc
// PollDraft
{ "title": "…", "description": "…", "coverImageUrl": "https://…/images/<uuid>.png",
  "opensAt": null,   // optional scheduled opening; null = opens on publish. Submit requires opensAt < closesAt
  "closesAt": "…",
  "audience": { "type": "public" } | { "type": "chula" } | { "type": "restricted", "rules": [{ "facultyCode": "21", "studentYear": 2567 }] },
  "settings": { "showResultsRealtime": false, "allowAnswerEdit": true, "listedPublicly": true },
  "elements": [
    { "type": "single_choice", "title": "อยากให้ธีมงานปีนี้เป็นแบบไหน", "isRequired": true,
      "config": { "layout": "list" },
      "options": [
        { "label": "ย้อนยุคสยาม", "description": null, "imageUrl": null, "imageAlt": null, "popup": null },
        { "label": "แสงสีร่วมสมัย", "popup": { "buttonText": "ดูรายละเอียด", "title": "…", "body": "…" } } ] },
    { "type": "page_break" },
    { "type": "text_question", "title": "ข้อเสนอแนะ", "config": { "placeholder": "…", "maxLength": 500 } },
    { "type": "image", "config": { "url": "https://…/images/<uuid>.png", "alt": "…", "caption": "…" } }
  ] }
```

Options: `{ label, description?, imageUrl?, imageAlt?, popup?: { buttonText?, title, body } }`.

Element `config` per type (validated with a zod discriminated union on `type`):

| type | config | options |
|---|---|---|
| `text_question` | `{ placeholder?, maxLength? (≤5000) }` | — |
| `single_choice` | `{ layout: "list" \| "grid" }` | 2–50 |
| `multi_choice` | `{ layout, minSelect?, maxSelect? }` | 2–50 |
| `dropdown` | `{}` | 2–200 |
| `description` | `{ showHeading, align: "left" \| "center" \| "right" (default left), sections: [{ heading?, body }] }` · submit ต้องมี heading หรือ body อย่างน้อยหนึ่งอย่างต่อ section | — |
| `image` | `{ url, alt?, caption? }` | — |
| `info_popup` | `{ buttonText?, title, body, imageUrl? }` | — |
| `accordion` | `{ title, body }` | — |
| `page_break` | `{}` | — |

## 5. Images

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/images/uploads` | user | `{ mimeType: "image/jpeg"\|"image/png"\|"image/webp", byteSize }` → `201 { uploadUrl, uploadHeaders, publicUrl, expiresInSeconds }`. `422 IMAGE_TOO_LARGE` over `IMAGE_MAX_BYTES` (5 MB). |

Flow (the file never passes through the API):

1. `POST /images/uploads` → get `uploadUrl` (temporary, 10 min) and `publicUrl` (permanent).
2. `PUT` the file to `uploadUrl` with `uploadHeaders`. Storage only accepts exactly the declared Content-Type and size.
3. Put `publicUrl` in the poll draft: `coverImageUrl`, an `image` element's `config.url`, an `info_popup`'s `config.imageUrl`, or an option's `imageUrl`.

Checks on the API side:

- Saving a draft (`POST`/`PUT /polls`): every image URL must be one we hand out (our bucket, `images/<uuid>.<ext>`). Anything else → `422 INVALID_IMAGE_URL` with `problems`. No outside links.
- Submitting (`POST /polls/:id/submit`): each file must exist in storage and its first bytes must really be JPEG/PNG/WebP; otherwise it shows up in `POLL_INCOMPLETE.problems` at the image's path.

The bucket needs public read (no CDN yet; set `S3_PUBLIC_BASE_URL` when one exists) and a
lifecycle rule to delete objects under `images/` that no poll uses (uploads that were abandoned).

## 6. Ballots

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/polls/:pollId/ballot` | user | My current answers (looked up by `voter_key`) → `200 Ballot` or `404 NO_BALLOT`. Used to prefill when editing. |
| PUT | `/polls/:pollId/ballot` | user | Submit or replace my answers. `201` first time, `200` on edit. |

`PUT` because the operation is an idempotent upsert of *my* ballot. Errors:

| Status | code | When |
|---|---|---|
| 404 | `POLL_NOT_FOUND` | poll not visible to you (not published, or you are outside its audience) |
| 409 | `POLL_NOT_STARTED` | open, but now < `opensAt` |
| 409 | `POLL_CLOSED` | status ≠ open **or** now ≥ `closesAt` |
| 409 | `ALREADY_VOTED` | ballot exists and `allowAnswerEdit=false` |
| 403 | `NOT_ELIGIBLE` | owner/admin who can see the poll but is outside its audience |
| 422 | `INVALID_ANSWERS` | missing required, option not in element, too many selections, … (`problems` lists each) |
| 429 | `RATE_LIMITED` | more than 20 ballot requests a minute; see `Retry-After` |

Omitted or empty answers count as unanswered. The poll row is locked while a ballot is saved, so no vote lands after the poll closes, and a burst of first votes from one person still yields one ballot.

```jsonc
// Ballot (request and response)
{ "answers": [
    { "elementId": "uuid", "optionIds": ["uuid"] },
    { "elementId": "uuid", "text": "ดีมาก" } ],
  "submittedAt": "2026-10-05T03:12:00Z" }   // response only, minute precision
```

## 7. Results

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/polls/:pollId/results?breakdown=none\|faculty\|year` | owner, admin, or voter when allowed* | Counts per option + total ballots. 3 s Redis cache (one DB query per poll per replica at a time), `ETag` → `304`. `403 RESULTS_HIDDEN` when not allowed. `breakdown` is owner/admin only. |
| GET | `/polls/:pollId/results/text?elementId=&cursor=&limit=` | owner, admin | Free-text answers for one question, as `{ text }` only: no ballot id, no time, order unrelated to submit time. |

\* Voters only while `resultDisplay.published` is true, and then: once voting has ended, or
live when `showResultsRealtime=true` **and they have already answered** (so early results
don't sway their vote).

Owner/admin get every question. Voters get only the choice questions in
`resultDisplay.elementIds` (`null` = all), and numbers the owner hid come back as `null`
(`showCount` → `count`, `showPercent` → `percent`, `showTotal` → `totalBallots` and `answered`).
Every option is listed, unanswered ones with 0. `percent` is of the people who answered that
question (1 decimal); `weight` = count ÷ the top option's count, for sizing bars and slices.

```jsonc
{ "totalBallots": 1243, "generatedAt": "…",
  "elements": [
    { "elementId": "uuid", "type": "single_choice", "answered": 1200,
      "options": [{ "optionId": "uuid", "count": 640, "percent": 53.3, "weight": 1 }] },
    { "elementId": "uuid", "type": "text_question", "answered": 87 } ],   // owner/admin only
  // only with ?breakdown=faculty|year
  "breakdown": { "by": "faculty", "minGroupSize": 5,
    "groups": [
      { "group": "21", "total": 300,
        "elements": [{ "elementId": "uuid", "options": [{ "optionId": "uuid", "count": 180 }] }] },
      { "group": "other", "hidden": true } ] } }
```

```jsonc
// ResultDisplay (PUT /polls/:pollId/result-display; also PollDetail.resultDisplay)
{ "published": true,                 // false = voters see no results at all
  "elementIds": null,                // choice questions voters see; null = all
  "views": ["list", "pie", "bar"],   // 1–3; how the web app draws them
  "showCount": true, "showPercent": true, "showTotal": true }
```

Groups with fewer than `RESULTS_MIN_GROUP_SIZE` (default 5) ballots are merged into `other`;
if `other` is still below that, it is returned as `hidden` with no numbers. Ballots from
accounts without a faculty/year (some staff) fall in group `unknown`.

## 8. Admin

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/admin/polls?status=pending_review&cursor=` | admin | Review queue: `pending_review` oldest-submitted first; other statuses newest first. |
| POST | `/admin/polls/:pollId/approve` | admin | → `approved`; the owner then publishes it. `422 CLOSES_AT_PASSED` if the deadline went by while pending. |
| POST | `/admin/polls/:pollId/reject` | admin | Body optional: `{ comment? }` → `rejected`; owner sees it in `reviews` and can edit + resubmit. |
| POST | `/admin/polls/:pollId/takedown` | admin | `{ reason }`. Force-close an open/closed poll, hide it from the feed, cancel its close job. The poll then shows `takenDown: true`, and the owner sees `takedownReason`. |
| GET | `/admin/admins` | admin | List admins (`id`, `studentId`, `cunexUserId`, `facultyCode`, `lastLoginAt`). |
| POST | `/admin/admins` | admin | `{ studentId }` (10 digits). Grant admin → the updated list. `404 USER_NOT_FOUND` until that person has logged in with CUNEX once. |
| DELETE | `/admin/admins/:userId` | admin | Revoke admin. `409 CANNOT_REVOKE_SELF` for yourself. The role is re-read on every request, so it applies immediately. |
| GET | `/admin/audit-logs?entityType=&entityId=&cursor=` | admin | Audit trail, newest first. |

All admin routes return `403 FORBIDDEN` to non-admins. The first admins come from
`ADMIN_BOOTSTRAP_CUNEX_IDS`; after that, admins grant each other here.

## 9. Ops

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness, process up. |
| GET | `/readyz` | Readiness: Postgres + Redis reachable. |

---

## Not exposed on purpose

- No endpoint returns `voter_key`, ballot ids, or who voted.
- No "list voters" / "who hasn't voted" for owners.
- Free-text answers are listed without ballot ids or timestamps, so they can't be joined with choices from the same ballot.
