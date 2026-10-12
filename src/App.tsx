import { useCallback, useEffect, useRef, useState } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { useRegistry } from './useRegistry';
import { useAuth, isAppLocked, type AuthSnapshot } from './auth/useAuth';
import { sanitizeReturnUrl } from './auth/returnUrl';
import { refreshSession, type TelegramAuthData } from './auth/api';
import { TopBar } from './components/TopBar';
import { AppLauncher } from './components/AppLauncher';
import { Home } from './components/Home';
import { ServiceFrame, type ServiceFrameHandle } from './components/ServiceFrame';
import { LoginModal } from './components/LoginModal';
import { SignInButton, UserMenu } from './components/UserMenu';
import { buildHash, parseHash, type HashState } from './shell/hash';
import type { AuthRequiredMessage, NavigateMessage } from './shell/messages';
import { decideAuthRequired } from './shell/authRequired';
import { NO_ACCESS_NOTICE, showNotice } from './shell/notice';
import type { Service } from './types';
import { AdminRoute } from './admin/AdminRoute';
import { ADMIN_ENTRY, ADMIN_ID, adminHash, parseAdminTab, type AdminTab } from './admin/route';
import { useInviteFlow } from './invite/useInviteFlow';
import classes from './App.module.css';

const THEME_COLOR = { light: '#fafafa', dark: '#0b0b0c' } as const;

/** `?login=1&return=/x` — set by standalone apps (web SDK `requestLogin`). */
function readLoginRequest(): { requested: boolean; returnTo: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { requested: params.get('login') === '1', returnTo: params.get('return') };
}

function clearLoginParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('login') && !url.searchParams.has('return')) return;
  url.searchParams.delete('login');
  url.searchParams.delete('return');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export default function App() {
  const { services, loading, error } = useRegistry();
  const scheme = useComputedColorScheme('light');
  const auth = useAuth();
  const isOwner = auth.status === 'authenticated' && auth.user?.isOwner === true;

  const [active, setActive] = useState<Service | null>(null);
  /** Non-null while the `#/admin[/<tab>]` route is shown. */
  const [adminTab, setAdminTab] = useState<AdminTab | null>(null);
  const [initialPath, setInitialPath] = useState('/');
  /** Bumped to remount the iframe (re-selecting the active service reloads it at its root). */
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<ServiceFrameHandle>(null);
  const activeRef = useRef<Service | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ----- Routing (hash) -----

  const applyHash = useCallback(
    (state: HashState) => {
      if (state.serviceId === ADMIN_ID) {
        setActive(null);
        setAdminTab(parseAdminTab(state.servicePath));
        return;
      }
      setAdminTab(null);
      const found = state.serviceId ? (services.find((s) => s.id === state.serviceId) ?? null) : null;
      setActive(found);
      setInitialPath(state.servicePath);
    },
    [services],
  );

  // Initialise from the hash once the registry has loaded (or failed — `#/admin` does not need it).
  useEffect(() => {
    if (loading) return;
    applyHash(parseHash(window.location.hash));
  }, [loading, applyHash]);

  // Browser Back / Forward.
  useEffect(() => {
    const onHashChange = () => applyHash(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyHash]);

  /** `null` → home. Always opens a service at its root (re-selecting the active one reloads it there). */
  const select = useCallback((service: Service | null) => {
    if (service && service.id === activeRef.current?.id) setFrameNonce((n) => n + 1);
    setAdminTab(null);
    setActive(service);
    setInitialPath('/');
    window.location.hash = service ? buildHash(service.id, '/') : '#/';
  }, []);

  const openAdmin = useCallback((tab: AdminTab = 'overview') => {
    setActive(null);
    setAdminTab(tab);
    window.location.hash = adminHash(tab);
  }, []);

  /** Tab switches replace the entry: Back leaves the console instead of walking its tabs. */
  const changeAdminTab = useCallback((tab: AdminTab) => {
    setAdminTab(tab);
    history.replaceState(history.state, '', adminHash(tab));
  }, []);

  // ----- Document chrome -----

  useEffect(() => {
    document.title = adminTab !== null && isOwner ? 'Админка · mvv42' : active ? `${active.name} · mvv42` : 'mvv42';
  }, [active, adminTab, isOwner]);

  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', THEME_COLOR[scheme]);
      m.removeAttribute('media');
    });
  }, [scheme]);

  // ----- Auth & login -----

  const [loginRequest] = useState(readLoginRequest);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginDismissed, setLoginDismissed] = useState(false);
  const [afterLogin, setAfterLogin] = useState<Service | null>(null);
  /** Subtitle of the login modal when sign-in is asked for a reason (an invite). */
  const [loginMessage, setLoginMessage] = useState<string | undefined>(undefined);
  /** Who opened the modal: closing it drops a pending invite only if the invite flow asked for sign-in. */
  const [loginReason, setLoginReason] = useState<'invite' | null>(null);

  const authAvailable = auth.status === 'anonymous' || auth.status === 'authenticated';
  // `?login=1` opens the modal as soon as we know the visitor is signed out.
  const modalOpened =
    auth.status === 'anonymous' && (loginOpen || (loginRequest.requested && !loginDismissed));

  // `?login=1` while already signed in → go straight back; auth unavailable → just drop the params.
  useEffect(() => {
    if (!loginRequest.requested) return;
    if (auth.status === 'authenticated') {
      const target = sanitizeReturnUrl(loginRequest.returnTo);
      if (loginRequest.returnTo && target !== '/') window.location.replace(target);
      else clearLoginParams();
    } else if (auth.status === 'unavailable') {
      clearLoginParams();
    }
  }, [auth.status, loginRequest]);

  const openLogin = useCallback((then: Service | null = null, message?: string, reason: 'invite' | null = null) => {
    setAfterLogin(then);
    setLoginMessage(message);
    setLoginReason(reason);
    setLoginOpen(true);
  }, []);

  /** An admin request answered 401/403: re-read /me — signed out → sign-in modal, no longer owner → 404 view. */
  const authRefresh = auth.refresh;
  const onAdminAuthLost = useCallback(() => {
    void authRefresh().then((next) => {
      if (next.status === 'anonymous') openLogin();
    });
  }, [authRefresh, openLogin]);

  // ----- Invite links (`?invite=CODE`, spec §10.10) -----

  const invite = useInviteFlow({
    authStatus: auth.status,
    ready: !loading,
    services,
    requestLogin: (message) => openLogin(null, message, 'invite'),
    applyMe: auth.apply,
    refreshAuth: auth.refresh,
    onAuthChanged: () => frameRef.current?.post({ type: 'AUTH_CHANGED' }),
    openService: (service) => select(service),
  });

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setLoginDismissed(true);
    setAfterLogin(null);
    setLoginMessage(undefined);
    setLoginReason(null);
    clearLoginParams();
    if (loginReason === 'invite') invite.cancel();
  }, [invite, loginReason]);

  const handleTelegramAuth = useCallback(
    async (data: TelegramAuthData) => {
      const next = await auth.login(data);
      frameRef.current?.post({ type: 'AUTH_CHANGED' });
      setLoginOpen(false);
      setLoginDismissed(true);
      setLoginMessage(undefined);
      if (loginRequest.requested && loginRequest.returnTo) {
        const target = sanitizeReturnUrl(loginRequest.returnTo);
        if (target !== '/') {
          window.location.replace(target);
          return;
        }
      }
      clearLoginParams();
      if (afterLogin) {
        if (isAppLocked(next.status, next.apps, afterLogin)) showNotice('no-access', NO_ACCESS_NOTICE);
        else select(afterLogin);
      }
      setAfterLogin(null);
    },
    [auth, loginRequest, afterLogin, select],
  );

  const handleLogout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      showNotice('logout-failed', 'Не удалось выйти. Попробуйте ещё раз.', 'error');
    } finally {
      frameRef.current?.post({ type: 'AUTH_CHANGED' });
    }
  }, [auth]);

  const isLocked = useCallback(
    (service: Service) => isAppLocked(auth.status, auth.apps, service),
    [auth.status, auth.apps],
  );

  const onLockedSelect = useCallback(
    (service: Service) => {
      if (auth.status === 'anonymous') openLogin(service);
      else if (auth.status === 'authenticated') showNotice('no-access', 'Нет доступа');
    },
    [auth.status, openLogin],
  );

  // ----- AUTH_REQUIRED from a service -----
  //
  // refreshSession() (navigator.locks) → re-read /me → decideAuthRequired(): signed out → login modal;
  // session changed → AUTH_CHANGED; unchanged → «Нет доступа к сервису» if the app is locked, otherwise
  // AUTH_CHANGED at most once per service per 10 s (no 401 ↔ AUTH_CHANGED loop). Requests that arrive
  // while auth is still 'loading' are queued until it settles.

  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const pendingAuthRequired = useRef(new Set<string>());
  const authRequiredInFlight = useRef(new Set<string>());
  const lastAuthChangedAt = useRef(new Map<string, number>());

  const postAuthChangedTo = useCallback((serviceId: string) => {
    if (activeRef.current?.id !== serviceId) return;
    lastAuthChangedAt.current.set(serviceId, Date.now());
    frameRef.current?.post({ type: 'AUTH_CHANGED' });
  }, []);

  const handleAuthRequired = useCallback(
    async (serviceId: string) => {
      if (authRequiredInFlight.current.has(serviceId)) return;
      authRequiredInFlight.current.add(serviceId);
      try {
        const before: AuthSnapshot = authRef.current;
        await refreshSession();
        const after = await authRef.current.refresh();
        const action = decideAuthRequired(before, after, serviceId, Date.now(), lastAuthChangedAt.current.get(serviceId));
        if (action.kind === 'login') openLogin();
        else if (action.kind === 'authChanged') postAuthChangedTo(serviceId);
        else if (action.kind === 'noAccess' && activeRef.current?.id === serviceId)
          showNotice('no-access', NO_ACCESS_NOTICE);
      } catch {
        // /me failures already map to 'unavailable' inside useAuth; nothing else to do.
      } finally {
        authRequiredInFlight.current.delete(serviceId);
      }
    },
    [openLogin, postAuthChangedTo],
  );

  // Drain AUTH_REQUIRED queued while auth was 'loading'.
  useEffect(() => {
    if (auth.status === 'loading' || pendingAuthRequired.current.size === 0) return;
    const queued = [...pendingAuthRequired.current];
    pendingAuthRequired.current.clear();
    if (auth.status === 'unavailable') return;
    for (const id of queued) void handleAuthRequired(id);
  }, [auth.status, handleAuthRequired]);

  // ----- Messages from the active service (already origin/source/serviceId-checked) -----

  const onServiceMessage = useCallback(
    (msg: NavigateMessage | AuthRequiredMessage) => {
      if (msg.type === 'NAVIGATE') {
        // replaceState: Back skips intermediate in-service steps and no hashchange fires.
        history.replaceState(history.state, '', buildHash(msg.serviceId, msg.path));
        return;
      }
      if (auth.status === 'loading') pendingAuthRequired.current.add(msg.serviceId);
      else if (auth.status !== 'unavailable') void handleAuthRequired(msg.serviceId);
    },
    [auth.status, handleAuthRequired],
  );

  // ----- Render -----

  const userSlot = !authAvailable ? undefined : auth.user ? (
    <UserMenu user={auth.user} onLogout={() => void handleLogout()} onAdmin={isOwner ? () => openAdmin() : undefined} />
  ) : (
    <SignInButton onClick={() => openLogin()} />
  );

  const launcher = (
    <AppLauncher
      services={services}
      activeId={active?.id ?? null}
      onSelect={select}
      isLocked={isLocked}
      onLockedSelect={onLockedSelect}
      extra={isOwner ? { entry: ADMIN_ENTRY, active: adminTab !== null, onSelect: () => openAdmin() } : undefined}
    />
  );

  let content;
  if (adminTab !== null) {
    content = (
      <AdminRoute
        authStatus={auth.status}
        user={auth.user}
        tab={adminTab}
        onTabChange={changeAdminTab}
        services={services}
        onHome={() => select(null)}
        onAuthLost={onAdminAuthLost}
      />
    );
  } else if (loading) {
    content = <div className={classes.status} aria-busy="true" />;
  } else if (error) {
    content = (
      <div className={classes.status} role="alert">
        <h1 className={classes.statusTitle}>Не удалось загрузить каталог</h1>
        <p className={classes.statusText}>registry.json: {error}</p>
        <button type="button" className={classes.statusAction} onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    );
  } else if (active) {
    content = (
      <ServiceFrame
        key={`${active.id}:${frameNonce}`}
        ref={frameRef}
        service={active}
        initialPath={initialPath}
        scheme={scheme}
        onServiceMessage={onServiceMessage}
      />
    );
  } else {
    content = (
      <Home services={services} onSelect={select} isLocked={isLocked} onLockedSelect={onLockedSelect} />
    );
  }

  return (
    <>
      <TopBar
        active={adminTab !== null && isOwner ? ADMIN_ENTRY : active}
        onHome={() => select(null)}
        launcher={launcher}
        userSlot={userSlot}
      />
      <div className={classes.main}>{content}</div>
      {authAvailable && <LoginModal opened={modalOpened} onClose={closeLogin} onAuth={handleTelegramAuth} message={loginMessage} />}
    </>
  );
}
