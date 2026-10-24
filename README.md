# Hackathon Voting API (Express + MongoDB + Google Sheets)

API only, no frontend is served. Build any frontend and call this API (set `CORS_ORIGIN`).
Only **team leaders** and **jury** log in and vote. Organizers manage people and settings from ONE Google Sheet.

## Google Sheet (one file, first row = header)
| Tab | Columns | Required |
|---|---|---|
| Leaders  | name, email, invite_code | yes |
| Jury     | name, email, invite_code | yes |
| Trial    | team, track, completed (TRUE/FALSE) | optional |
| Settings | key, value | optional |

- `invite_code`: a random code (min 6 chars) you give each person privately. Without it nobody can create the account, so knowing an email is not enough. Stored only as a hash.
- Settings keys: `voting_open` (TRUE/FALSE), `voting_opens_at`, `voting_closes_at` (ISO, e.g. 2026-10-24T18:00:00+05:30).
- Track can be the key (`design_3d`) or the label (`3D Design`).
- The server re-reads the sheet every `SHEET_SYNC_SECONDS` (default 60). Removed from the sheet = access lost.

## Setup
1. Free sheet access without Google Cloud: sheet -> Extensions -> Apps Script, paste `apps-script/Code.gs`, set SECRET, Deploy as Web app (Execute as: Me, Access: Anyone). Put the URL and SECRET in `.env` (`GOOGLE_SCRIPT_URL`, `GOOGLE_SCRIPT_SECRET`). Alternative: Google Cloud service account (`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`).
2. `cp .env.example .env` and fill it (MONGODB_URI, JWT_SECRET, ADMIN_DELETE_HASH, CORS_ORIGIN, FRONTEND_URL...). Set `FRONTEND_URL` to the public Vercel frontend URL (defaults to `https://fuck-fallingsun.vercel.app`) and allow that same origin in `CORS_ORIGIN`.
3. `npm install && npm start`. Check `GET /api/health`.
Local test without Google: `LOCAL_SHEET_FILE=./sheet.example.json`.

## Flow
1. Person gets email + invite code from organizers -> `POST /api/auth/register` (once) -> token. Later `POST /api/auth/login`.
2. Leader `POST /api/teams` (once), optionally including a public `github_url` (`https://github.com/owner/repository`). Response has `team_url`; `GET /api/teams/:id/qr.png` is the QR and opens the customized public project page at `FRONTEND_URL/team/:id`. Eligible logged-in leaders and jury can submit ratings from that page while voting is open.
3. Leaders and jury `POST /api/votes`; jury also `POST /api/votes/presentation`.
4. `GET /api/leaderboard`.
5. Robotics: jury scores ideation, then `npm run robotics:finalize -- 20`; eliminated leaders `POST /api/teams/me/transfer`.

Send the token as `Authorization: Bearer <token>`. `GET /api` lists every endpoint with body examples.

## Rules enforced
- One vote counts per voter per project (unique index); edits allowed, max `MAX_SUBMISSIONS` (3) in total, atomic.
- Leader: must have a team, cannot vote own project, only own category (`LEADER_SAME_CATEGORY_ONLY`).
- Team disqualified if its leader rated fewer than 5 (game) / 10 (web) projects (robotics 5, my guess).
- Voting only while open. Every vote/edit is logged in `voteaudits`.
- Register: 5 wrong invite codes lock that account for 15 min, plus per-IP rate limits. Passwords: 8+ chars (max 72 bytes), bcrypt.
- Forgot password: `DELETE /api/admin/users` with `{email, verification_hash}` (`ADMIN_DELETE_HASH` from `.env`) clears the account's password and logs the user out everywhere. They set a new one via `POST /api/auth/register`, which still needs their `invite_code`. Removing someone for good = delete their row from the sheet.

## Score (100)
Trial 25 (5 per completed track) + Jury presentation 25 + Jury rating 25 + Leaders' vote 25.