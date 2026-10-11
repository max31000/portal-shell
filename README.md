# portal-shell

The shell for **https://mvv42.ru**: a small React SPA served at `/` that hosts every service in a same-origin
`<iframe src="/<id>/">`. It owns the top bar, the app launcher, the home page, sign-in (via `mvv42-auth`) and the
light/dark theme. Each service stays a standalone app at `/<id>/`.

Stack: React 19, Vite, Mantine 9, TypeScript, Vitest.

## Routing

The shell routes in the hash: `#/<serviceId><path>` → iframe `src = <service.path without trailing slash><path>`.

| URL | Shows |
|---|---|
| `/` or `/#/` | Home |
| `/#/cashpulse` | `/cashpulse/` |
| `/#/cashpulse/operations?x=1` | `/cashpulse/operations?x=1` |
| `/?login=1&return=/bonds/` | Opens sign-in, then returns to `/bonds/` (same-origin paths only) |

## Registry (`public/registry.json`)

UI catalogue only — who may use what lives in the `apps` table of `mvv42-auth` (same `id`).

```json
{
  "version": 1,
  "services": [
    {
      "id": "cashpulse",
      "name": "CashPulse",
      "description": "Прогноз денежного потока",
      "icon": "chart-area-line",
      "path": "/cashpulse/",
      "color": "#228be6"
    }
  ]
}
```

- `icon` — a [Tabler](https://tabler.io/icons) icon name from the allow-list in `src/components/icons.ts`
  (add a name there when a new app needs one). Unknown names fall back to the first letter of `name`.
- `color` — used only for the service's icon tile.
- `auth` — set to `"shared"` once the service uses mvv42-auth (migration Ф2). Only then may the shell lock its
  tile / show login for it. Absent = the service still has its own login and is never locked by the shell.

Vite serves `public/registry.json` in dev and copies it into `dist/` on build; it is fetched with `no-cache`.

## Shell ↔ service protocol (`postMessage`)

All messages are same-origin. Senders use `targetOrigin = location.origin`. The shell accepts a message only if
`event.origin === location.origin`, `event.source` is the active iframe's `contentWindow`, **and** `serviceId`
equals that iframe's service. Types and guards: `src/shell/messages.ts`.

| Direction | Message | Meaning |
|---|---|---|
| service → shell | `{type:'READY', serviceId}` | App is listening; shell replies with `THEME` |
| service → shell | `{type:'NAVIGATE', serviceId, path}` | In-app route changed; shell mirrors it into the hash (`replaceState`) |
| service → shell | `{type:'AUTH_REQUIRED', serviceId}` | Session problem; shell refreshes and decides (see Auth) |
| shell → service | `{type:'THEME', scheme:'light'\|'dark'}` | Resolved scheme; sent on `READY`, iframe load and every change |
| shell → service | `{type:'AUTH_CHANGED'}` | Sign-in / sign-out happened; re-read `/auth/api/me` |

## Auth

On boot the shell calls `GET /auth/api/me` (the server refreshes the access cookie implicitly).
Anything other than a `200` with the expected JSON — e.g. before `mvv42-auth` is deployed — puts the shell in
**unavailable** mode: no user slot, no locks, everything works exactly as without auth.

When auth is up: «Войти» opens a Telegram Login Widget modal (bot from `VITE_TELEGRAM_BOT_USERNAME`, default
`mv_cashpulse_bot`); tiles of apps that need sign-in and are not granted show a lock (`!anonymous && !granted`).
Clicking a locked tile signed out opens sign-in and then the app (if the new session grants it); signed in, it
shows «Нет доступа».

The shell never refreshes on boot (`/me` does it implicitly). The only explicit `POST /auth/api/refresh` runs under
`navigator.locks.request('mvv42-refresh')` (in-memory single-flight as fallback, 10 s request timeout), so tabs and
iframes never rotate the refresh token concurrently.

`AUTH_REQUIRED` from the active service:

1. If auth is still loading, the request is queued until `/me` settles (dropped if auth turns out unavailable).
2. `refreshSession()` under the lock, then `/me` again.
3. Signed out → sign-in modal. Signed in and the session (user, admin flag, grants) changed → `AUTH_CHANGED`.
4. Signed in and unchanged → if the app is locked for this user, a «Нет доступа к сервису» notice; otherwise
   `AUTH_CHANGED`, at most once per service per 10 s (a service stuck on 401 cannot make the shell loop).

`/me` (and the `/telegram` login response) is `{ user: { id, telegramId, name, username|null, photoUrl|null,
isAdmin } | null, apps: [{ id, anonymous, access, granted }] }`; `id`/`telegramId` arrive as JSON numbers and are
normalised to strings. Sign-out always posts `AUTH_CHANGED`, even if the request failed (an error notice is shown).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — /cashpulse, /bonds, /credit_calc and /auth are proxied to https://mvv42.ru
npm test           # vitest (jsdom)
npm run lint
npm run build      # tsc -b && vite build → dist/
```

Design tokens (type scale, colours, radii, shadows, motion) live in `src/styles/tokens.css`; the Mantine theme in
`src/theme.ts` maps onto them.

## Deploy

`.github/workflows/deploy.yml` on push to `main`: install → lint → test → build (`tsc -b && vite build`) → copy `dist/` to
`/var/www/portal/` on the VDS.
