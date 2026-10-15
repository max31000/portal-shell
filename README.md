# portal-shell

The shell for **https://mvv42.ru**: a small React SPA served at `/` that hosts every service in a same-origin
`<iframe src="/<id>/">`. It owns the top bar, the app launcher, the home page, sign-in (via `mvv42-auth`) and the
light/dark theme. Each service stays a standalone app at `/<id>/`.

Stack: React 19, Vite, Mantine 9 (≥ 9.4), `@mvv42/kit`, TypeScript, Vitest.

## Routing

The shell routes in the hash: `#/<serviceId><path>` → iframe `src = <service.path without trailing slash><path>`.

| URL | Shows |
|---|---|
| `/` or `/#/` | Home |
| `/#/cashpulse` | `/cashpulse/` |
| `/#/cashpulse/operations?x=1` | `/cashpulse/operations?x=1` |
| `/?login=1&return=/bonds/` | Opens sign-in, then returns to `/bonds/` (same-origin paths only) |
| `/#/admin`, `/#/admin/<tab>` | Admin console (`users`, `apps`, `invites`, `log`, `monitoring[/<section>]`) — owner only (`me.user.isOwner`); a 404 view for everyone else |
| `/?invite=<code>` | Invite link: sign in if needed, redeem, open the service (see Invites) |

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

When auth is up: «Войти» opens the sign-in modal; tiles of apps that need sign-in and are not granted show a lock
(`!anonymous && !granted`). Clicking a locked tile signed out opens sign-in (subtitle «Чтобы открыть «X», войдите»)
and then the app (if the new session grants it); signed in, it shows «Нет доступа».

### Sign-in modal (code first)

Registration is closed, and Telegram must not learn about — or send us data of — a stranger: the Telegram Login
Widget (`telegram-widget.js`, bot from `VITE_TELEGRAM_BOT_USERNAME`, default `mv_cashpulse_bot`) is mounted only once
the visitor has a checked invite code or says they already have an account.

| Step | Shown | Telegram |
|---|---|---|
| **A «Код»** (default) | «Вход только по приглашению», code field, «Продолжить» → `POST /auth/api/invites/check`; contact @mvv42; «У меня уже есть аккаунт» → C | not loaded |
| **B «Код принят»** | the service the code opens («Код даёт доступ к …» / «Код для входа»); the code goes as `X-Invite-Code`; «Изменить код» → A | widget |
| **C «Есть аккаунт»** | «Если аккаунта нет, вход не выполнится и данные не сохранятся»; «Новый пользователь? Ввести код» → A | widget |

- Start: a pending invite (`?invite=`) or a typed draft → A with one automatic check per opening (→ B on success);
  otherwise the device marker → C; otherwise A. Every opening starts afresh. A code typed into the field
  (`sessionStorage['mvv42-invite-draft']`) overrides a link code captured earlier; opening a fresh `?invite=` link
  clears the draft, so the newest link wins again.
- `invite_*` from `/telegram` in B → A with the code and the error; `invite_required` in C → the marker is removed,
  A with «Аккаунт не найден. Нужен код приглашения». In both cases the widget payload stays in memory (never in
  storage) and is resent automatically as soon as a code passes the check — no second Telegram click.
- A rate limit on the check is recognised by status 429 (nginx answers with HTML).
- After sign-in: the invite's service if the login registered the user with an app invite (even over
  `?login=1&return=`), otherwise the return URL, otherwise the service sign-in was asked for. Leaving B/C removes the widget's script tag and iframe; `window.Telegram` and the cached
  script stay (Telegram has been contacted by then anyway).

**Device marker** `localStorage['mvv42-has-account'] = '1'` — set after every successful sign-in and whenever `/me`
returns a signed-in user (so existing users get it on their first visit). It holds no PII and is **only a UI hint**
(which step the modal opens on): every service on the same origin (`mvv42.ru`) can read and write it, so it is never
used for access decisions. **Sign-out keeps it** — on a shared device the next person sees step C first and switches to
«Новый пользователь? Ввести код» (accepted risk). Storage errors count as «no marker» (step A).

The shell never refreshes on boot (`/me` does it implicitly). The only explicit `POST /auth/api/refresh` runs under
`navigator.locks.request('mvv42-refresh')` (in-memory single-flight as fallback, 10 s request timeout), so tabs and
iframes never rotate the refresh token concurrently.

`AUTH_REQUIRED` from the active service:

1. If auth is still loading, the request is queued until `/me` settles (dropped if auth turns out unavailable).
2. `refreshSession()` under the lock, then `/me` again.
3. Signed out → sign-in modal. Signed in and the session (user, admin flag, grants) changed → `AUTH_CHANGED`.
4. Signed in and unchanged → if the app is locked for this user, a «Нет доступа к сервису» notice; otherwise
   `AUTH_CHANGED`, at most once per service per 10 s (a service stuck on 401 cannot make the shell loop).

`/me` (and the `/telegram` login response) is the kit's `Me`: `{ user: { id, telegramId, name, username|null,
photoUrl|null, isAdmin, isOwner } | null, apps: [{ id, anonymous, access, granted }] }` (ids are JSON numbers; an
older auth without `isOwner` means «no owner»). The shell keeps its own client (`src/auth/api.ts`: any non-200 /
malformed `/me` → unavailable mode); admin calls and the invite redeem use the kit's `apiJson`. Sign-out always posts `AUTH_CHANGED`, even if the request failed (an error notice is shown).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — /cashpulse, /bonds, /credit_calc and /auth are proxied to https://mvv42.ru
npm test           # vitest (jsdom)
npm run lint
npm run build      # tsc -b && vite build → dist/
```

## Admin console (`#/admin`)

Owner-only UI over the mvv42-auth admin API (`src/admin/api.ts` — typed client for every `/auth/api/admin/*`
endpoint): **Обзор** (metrics, services), **Пользователи** (search, drawer: grants, admin flag, block, sessions,
recent logins), **Сервисы** (anonymous / access mode), **Инвайты** (create → link shown once, list, delete),
**Журнал** (login events, paged with `nextBefore`). Entry points — the «Админка» launcher tile and user-menu item —
exist only for `isOwner`. Built with `@mvv42/kit` components + Mantine `Tabs`; loaded as a separate chunk.

**Мониторинг** (`src/admin/monitoring/`, its own lazy chunk with Recharts) reads the owner-only proxy
`/monitoring/api/*` (VictoriaMetrics, VictoriaLogs, vmalert — see `mvv42-infra/docs/specs/2026-10-16-monitoring-ui.md`):
Обзор, Сервер, Контейнеры, HTTP, Приложения (prometheus-net metrics of the .NET services, job `apps`), Логи
(LogsQL search, level histogram, live tail), Алерты; a shared period
(1ч…30д) and a 30 s auto-refresh paused while the browser tab is hidden. The section is kept in the hash
(`#/admin/monitoring/<section>`, `replaceState`). A chart is a declaration (`PromChartSpec`: PromQL with
`$__rate` / `$__range`, legend, unit, kind) rendered by `PromChart`.

## Invites

`/?invite=<code>`: the shell removes the parameter at once (`history.replaceState`) and keeps the code in
`sessionStorage` (`mvv42-invite`).

- Signed out → sign-in modal on step A with the code, checked at once → B → Telegram with `X-Invite-Code`. A new
  user is registered by that login (the response carries `invite`, no redeem); a known user → redeem below.
- Signed in → `POST /auth/api/invites/redeem` → «Доступ к … открыт» (or «уже есть»), `AUTH_CHANGED` to the frame,
  the service opens.

Redeem errors (`invite_expired`, `invite_exhausted`, `invite_not_found`) drop the code with a notice; closing the
sign-in modal drops it too.

## Design

The shell is built on [`@mvv42/kit`](https://github.com/max31000/mvv42-kit) (`accent: 'zinc'`): `Mvv42Provider`
(theme, shared `mvv42-color-scheme` setting, notifications), `@mvv42/kit/styles.css` (`--mvv-*` tokens), the
`mvv42Html()` Vite plugin (anti-flash colour-scheme script) and `resolve.dedupe`. Shell-only CSS (layers, small
fixes) lives in `src/styles/global.css`; components use CSS modules on `--mvv-*` tokens.

## Deploy

`.github/workflows/deploy.yml` on push to `main`: install → lint → test → build (`tsc -b && vite build`) → copy `dist/` to
`/var/www/portal/` on the VDS.
