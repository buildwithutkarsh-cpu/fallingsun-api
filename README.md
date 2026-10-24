# Hackathon Voting (Express + MongoDB + Google Sheets)

Only **team leaders** and **jury** log in and vote. There is no admin.
Organizers manage everything from ONE Google Sheet file.

## Google Sheet layout (one file, several tabs, first row = header)
| Tab | Columns | Required |
|---|---|---|
| Leaders  | name, email | yes |
| Jury     | name, email | yes |
| Trial    | team, track, completed (TRUE/FALSE) | optional |
| Settings | key, value | optional |

- Leaders and jury create a password once using an email listed on the sheet, then log in with email + password. Passwords are hashed and stored in MongoDB; registration is only available while an account is active on the sheet. Anyone who knows a listed email can claim that account during first-time setup. Passwords cannot be reset through the site.
- Track can be the key (`design_3d`) or the label (`3D Design`).
- Settings keys: `voting_open` (TRUE/FALSE), `voting_opens_at`, `voting_closes_at` (ISO date, e.g. 2026-10-24T18:00:00+05:30).
- The server re-reads the sheet every SHEET_SYNC_SECONDS (default 60). Remove someone from the sheet and they lose access.

## Setup without Google Cloud (free, no credit card)
1. Open your sheet -> Extensions -> Apps Script. Delete the sample code, paste `apps-script/Code.gs`, change SECRET to a long random string, Save.
2. Deploy -> New deployment -> type "Web app" -> Execute as: Me -> Who has access: Anyone -> Deploy. Allow the permissions.
3. Copy the Web app URL (ends with /exec).
4. In `.env`: `GOOGLE_SCRIPT_URL=<that url>` and `GOOGLE_SCRIPT_SECRET=<same SECRET>`.
The URL alone returns nothing without the secret, so the sheet stays private. After editing the script, use Deploy -> Manage deployments -> edit -> New version.

## Setup with a Google Cloud service account (alternative)
1. Google Cloud: create a service account, enable Google Sheets API, download its key.
2. Share the sheet (Viewer) with the service account email.
3. Copy `.env.example` to `.env` and fill MONGODB_URI, JWT_SECRET, BASE_URL, and GOOGLE_* values.
4. `npm install && npm start`

No Google yet? Set `LOCAL_SHEET_FILE=./sheet.example.json` to test with a local file.

## Flow
1. Leader creates an account using their sheet-listed email and a password -> logs in -> submits team details to `POST /api/teams`.
2. Clients fetch team details from `GET /api/teams/:id` and can use its QR image endpoint. Leaders and jury submit votes through the API.
3. `/leaderboard.html` shows the result.
4. Robotics: jury scores the ideation round, then run `npm run robotics:finalize -- 20`
   (top 20 selected, rest can transfer to web/game from the Projects page).

## Rules enforced by the backend
- One vote counts per voter per project (unique index). You may edit it, max 3 submissions total (atomic).
- A leader cannot vote for own project, must have registered a team, and can only vote inside their own category
  (turn off with `LEADER_SAME_CATEGORY_ONLY=false` in src/config.js).
- A team is disqualified when its leader rated fewer than 5 (game) / 10 (web) projects. Robotics minimum is 5 (my guess, change in config).
- Voting only while open (Settings tab / time window).
- Every vote create/edit is written to the `voteaudits` collection.
- Accounts removed from the sheet are deactivated immediately on next sync; tokens expire after 6h.
- For a forgotten password, an admin can clear an active account's password with `DELETE /api/admin/users` using its email and the `ADMIN_DELETE_HASH` verification value. The user can then set a new password through registration.
- A broken or empty sheet never wipes the existing accounts.

## Score (100)
Trial 25 (5 per completed track) + Jury presentation 25 + Jury rating 25 + Leaders' vote 25.

## API
The service is API-only. `GET /` identifies the service, and `GET /api` lists endpoints and access requirements. Send JSON request bodies with `Content-Type: application/json`; after login, send `Authorization: Bearer <token>` for authenticated endpoints. Responses and errors are JSON except the QR endpoint, which returns a PNG.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/health` | Public | Service and sheet-sync health |
| GET | `/api/config` | Public | Categories, tracks, and voting criteria |
| POST | `/api/auth/register` | Public | Set an initial password or a new password after an admin reset (`{email, password}`) |
| POST | `/api/auth/login` | Public | Login (`{email, password}`), returns token and user |
| GET | `/api/auth/me` | Authenticated | Current user and team |
| DELETE | `/api/admin/users` | Admin verification hash | Clear an active user's password for password reset (`{email, verification_hash}`) |
| GET | `/api/teams?category=game` | Public | List teams, optionally filtered by category |
| POST | `/api/teams` | Leader | Register a team |
| GET | `/api/teams/:id` | Public | Team details |
| GET | `/api/teams/:id/qr.png` | Public | QR code pointing to the team API resource |
| POST | `/api/teams/me/transfer` | Leader | Transfer an eliminated robotics team to web/game |
| POST | `/api/votes` | Leader or jury | Create/update a project vote (`{team_id, scores}`) |
| GET | `/api/votes/mine` | Leader or jury | Current user's project votes |
| POST | `/api/votes/presentation` | Jury | Create/update a presentation score (`{team_id, score}`) |
| GET | `/api/votes/presentation/mine` | Jury | Current user's presentation scores |
| POST | `/api/robotics/ideation` | Jury | Create/update robotics ideation scores |
| GET | `/api/robotics/ideation/ranking` | Jury | Robotics ideation ranking and criteria |
| GET | `/api/leaderboard?category=game` | Public | Leaderboard, optionally filtered by category |

Set `ADMIN_DELETE_HASH` on the server to a long, randomly generated secret. Only admins should know this value; send it as `verification_hash` over HTTPS. To reset a forgotten password, send `DELETE /api/admin/users` with `{ "email": "...", "verification_hash": "..." }`. This clears only the password hash; it does not delete or deactivate the user, team, or voting history. The user can then use `POST /api/auth/register` to set a new password.
