import { useCallback, useEffect, useRef, useState } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { useRegistry } from './useRegistry';
import { useAuth, isAppLocked } from './auth/useAuth';
import { sanitizeReturnUrl } from './auth/returnUrl';
import type { TelegramAuthData } from './auth/api';
import { TopBar } from './components/TopBar';
import { AppLauncher } from './components/AppLauncher';
import { Home } from './components/Home';
import { ServiceFrame, type ServiceFrameHandle } from './components/ServiceFrame';
import { LoginModal } from './components/LoginModal';
import { SignInButton, UserMenu } from './components/UserMenu';
import { buildHash, parseHash, type HashState } from './shell/hash';
import type { AuthRequiredMessage, NavigateMessage } from './shell/messages';
import type { Service } from './types';
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

  const [active, setActive] = useState<Service | null>(null);
  const [initialPath, setInitialPath] = useState('/');
  const frameRef = useRef<ServiceFrameHandle>(null);

  // ----- Routing (hash) -----

  const applyHash = useCallback(
    (state: HashState) => {
      if (services.length === 0) return;
      const found = state.serviceId ? (services.find((s) => s.id === state.serviceId) ?? null) : null;
      setActive(found);
      setInitialPath(state.servicePath);
    },
    [services],
  );

  // Initialise from the hash once the registry has loaded.
  useEffect(() => {
    if (services.length === 0) return;
    applyHash(parseHash(window.location.hash)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [services, applyHash]);

  // Browser Back / Forward.
  useEffect(() => {
    const onHashChange = () => applyHash(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyHash]);

  /** `null` → home. Always opens a service at its root. */
  const select = useCallback((service: Service | null) => {
    setActive(service);
    setInitialPath('/');
    window.location.hash = service ? buildHash(service.id, '/') : '#/';
  }, []);

  // ----- Document chrome -----

  useEffect(() => {
    document.title = active ? `${active.name} · mvv42` : 'mvv42';
  }, [active]);

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

  const openLogin = useCallback((then: Service | null = null) => {
    setAfterLogin(then);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setLoginDismissed(true);
    setAfterLogin(null);
    clearLoginParams();
  }, []);

  const handleTelegramAuth = useCallback(
    async (data: TelegramAuthData) => {
      await auth.login(data);
      frameRef.current?.post({ type: 'AUTH_CHANGED' });
      setLoginOpen(false);
      setLoginDismissed(true);
      if (loginRequest.requested && loginRequest.returnTo) {
        const target = sanitizeReturnUrl(loginRequest.returnTo);
        if (target !== '/') {
          window.location.replace(target);
          return;
        }
      }
      clearLoginParams();
      if (afterLogin) select(afterLogin);
      setAfterLogin(null);
    },
    [auth, loginRequest, afterLogin, select],
  );

  const handleLogout = useCallback(async () => {
    await auth.logout();
    frameRef.current?.post({ type: 'AUTH_CHANGED' });
  }, [auth]);

  const isLocked = useCallback(
    (service: Service) => isAppLocked(auth.status, auth.apps, service.id),
    [auth.status, auth.apps],
  );

  const onLockedSelect = useCallback(
    (service: Service) => {
      if (auth.status === 'anonymous') openLogin(service);
    },
    [auth.status, openLogin],
  );

  // ----- Messages from the active service (already origin/source/serviceId-checked) -----

  const onServiceMessage = useCallback(
    (msg: NavigateMessage | AuthRequiredMessage) => {
      if (msg.type === 'NAVIGATE') {
        // replaceState: Back skips intermediate in-service steps and no hashchange fires.
        history.replaceState(history.state, '', buildHash(msg.serviceId, msg.path));
        return;
      }
      if (auth.status === 'anonymous') openLogin();
      else if (auth.status === 'authenticated') frameRef.current?.post({ type: 'AUTH_CHANGED' });
    },
    [auth.status, openLogin],
  );

  // ----- Render -----

  const userSlot = !authAvailable ? undefined : auth.user ? (
    <UserMenu user={auth.user} onLogout={() => void handleLogout()} />
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
    />
  );

  let content;
  if (loading) {
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
        key={active.id}
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
      <TopBar active={active} onHome={() => select(null)} launcher={launcher} userSlot={userSlot} />
      <div className={classes.main}>{content}</div>
      {authAvailable && <LoginModal opened={modalOpened} onClose={closeLogin} onAuth={handleTelegramAuth} />}
    </>
  );
}
