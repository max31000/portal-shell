# Задача: интеграция сервиса с portal-shell (mvv42.ru)

## Контекст

Ты вносишь изменения в репозиторий микрофронтенд-сервиса, который деплоится
по субпути (например, `/cashpulse/`). Сервис встраивается в portal-shell через
`<iframe>`, но также должен работать самостоятельно (standalone).

Portal-shell живёт на `https://mvv42.ru/`. Он загружает сервисы так:

```html
<iframe src="/cashpulse/" />
```

Shell отслеживает активный сервис через query-параметр в своём URL:
`https://mvv42.ru/?app=cashpulse`

nginx на сервере настроен так, что SPA-роутинг работает для субпути:

```nginx
location /cashpulse/ {
    root /var/www;
    try_files $uri $uri/ /cashpulse/index.html;
}
```

---

## Проблема 1 (КРИТИЧЕСКАЯ): неправильный basename в React Router

### Что идёт не так без basename

React Router по умолчанию считает, что приложение развёрнуто в корне `/`.
Если сервис задеплоен на `/cashpulse/`, но `basename` не выставлен, происходит
следующее:

- Пользователь открывает `/cashpulse/` — приложение загружается ✓
- Внутри приложения есть ссылка `<Link to="/transactions">` — она генерирует
  href `/transactions` вместо `/cashpulse/transactions` ✗
- `navigate('/transactions')` делает `pushState` на `/transactions` ✗
- Браузер уходит на `/transactions` — nginx не знает такого пути, 404 ✗
- Или, что хуже, `/transactions` совпадает с каким-то другим сервисом ✗

**Конкретный пример поломки:**

```tsx
// БЕЗ basename — СЛОМАНО
function App() {
  return (
    <BrowserRouter>  {/* basename не задан → считает что root = "/" */}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
      </Routes>
    </BrowserRouter>
  );
}

// Пользователь на /cashpulse/, кликает на <Link to="/transactions">
// → браузер идёт на /transactions (неправильно!)
// → должно быть /cashpulse/transactions
```

---

## Исправление 1: выставить basename в React Router v6

### Вариант A — `BrowserRouter` (простые приложения)

```tsx
// src/main.tsx или src/App.tsx
import { BrowserRouter } from 'react-router-dom';

const BASE_PATH = import.meta.env.BASE_URL; // берём из Vite (см. ниже)

function App() {
  return (
    <BrowserRouter basename={BASE_PATH}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        {/* Все пути пишем относительно basename, без /cashpulse/ префикса */}
      </Routes>
    </BrowserRouter>
  );
}
```

### Вариант B — `createBrowserRouter` (Data Router, рекомендован в RRv6.4+)

```tsx
// src/router.ts
import { createBrowserRouter } from 'react-router-dom';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'transactions', element: <Transactions /> },
        { path: 'settings', element: <Settings /> },
      ],
    },
  ],
  {
    basename: import.meta.env.BASE_URL, // '/cashpulse'
  }
);

// src/main.tsx
import { RouterProvider } from 'react-router-dom';
import { router } from './router';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
);
```

> **Важно:** все пути в маршрутах пиши без префикса субпути. React Router
> сам добавит `basename`. То есть `path: 'transactions'` — правильно,
> `path: '/cashpulse/transactions'` — неправильно.

---

## Исправление 2: выставить `base` в Vite

Vite должен знать субпуть, чтобы правильно генерировать пути к статическим
ассетам (JS/CSS/images). Без этого скрипты будут подключаться как
`/assets/index.js` вместо `/cashpulse/assets/index.js`.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  base: '/cashpulse/', // ← субпуть деплоя, обязательно с trailing slash

  // base можно также читать из env-переменной для гибкости:
  // base: process.env.VITE_BASE_PATH ?? '/cashpulse/',
});
```

После этого `import.meta.env.BASE_URL` в рантайме будет равен `'/cashpulse/'`,
и его можно передавать напрямую в `basename` React Router (React Router
принимает как со слешем, так и без — `/cashpulse/` и `/cashpulse` оба
корректны).

**Проверь `index.html`:** Vite автоматически обновит пути к скриптам при
сборке, но убедись, что нет хардкода:

```html
<!-- Должно быть так (Vite подставит правильный путь при build): -->
<script type="module" src="/src/main.tsx"></script>

<!-- НЕ должно быть хардкода вроде: -->
<script src="/assets/index.js"></script>
```

---

## Проблема 2 (ОПЦИОНАЛЬНО): синхронизация URL с shell через postMessage

### Зачем это нужно

Когда пользователь находится в iframe и переходит внутри сервиса
(например, `/cashpulse/` → `/cashpulse/transactions`), URL в адресной строке
браузера не меняется — он всё ещё показывает `https://mvv42.ru/?app=cashpulse`.

Shell может отображать текущий путь внутри сервиса (например, в title страницы
или в URL для шаринга). Для этого сервис должен сообщать shell о навигации.

### Протокол postMessage

**Сервис → Shell** (отправка при каждой навигации):

```ts
// Тип сообщения
interface NavigateMessage {
  type: 'NAVIGATE';
  serviceId: string; // идентификатор сервиса, например 'cashpulse'
  path: string;      // текущий путь относительно basename, например '/transactions'
}

// Функция отправки
function notifyShellOfNavigation(path: string) {
  if (window.self === window.top) return; // не в iframe — ничего не делаем

  window.parent.postMessage(
    {
      type: 'NAVIGATE',
      serviceId: 'cashpulse', // замени на реальный ID сервиса
      path,                    // например '/transactions' или '/'
    } satisfies NavigateMessage,
    'https://mvv42.ru' // targetOrigin — только для shell, не '*'
  );
}
```

### Интеграция с React Router

```tsx
// src/hooks/useShellSync.ts
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function useShellSync(serviceId: string) {
  const location = useLocation();

  useEffect(() => {
    if (window.self === window.top) return; // standalone — пропускаем

    window.parent.postMessage(
      {
        type: 'NAVIGATE',
        serviceId,
        path: location.pathname + location.search + location.hash,
      },
      'https://mvv42.ru'
    );
  }, [location, serviceId]);
}

// Использование в корневом компоненте:
// src/App.tsx
function App() {
  useShellSync('cashpulse');

  return (
    <Routes>
      {/* ... */}
    </Routes>
  );
}
```

> **Безопасность:** всегда указывай конкретный `targetOrigin`
> (`'https://mvv42.ru'`), никогда не используй `'*'` — это предотвращает
> утечку навигационных данных на сторонние сайты.

---

## Определение контекста: iframe vs standalone

Используй эту проверку везде, где поведение должно отличаться:

```ts
const isInsideShell = window.self !== window.top;

// Примеры использования:
if (isInsideShell) {
  // Скрыть header/navbar сервиса, если shell показывает свой
  // Отправлять postMessage при навигации
  // Не показывать кнопку "Назад на главную"
}
```

Или в виде хука:

```ts
// src/hooks/useIsInsideShell.ts
export function useIsInsideShell(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // если не можем проверить — считаем, что в iframe
  }
}
```

---

## Чеклист проверки интеграции

После внесения изменений проверь каждый пункт вручную:

### Базовая работоспособность

- [ ] `npm run build` — сборка не упала
- [ ] Открой `http://localhost:PORT/cashpulse/` — приложение загружается без
      ошибок в консоли
- [ ] В DevTools → Network убедись, что JS/CSS подключаются с путём
      `/cashpulse/assets/...`, а не `/assets/...`

### React Router и basename

- [ ] Кликни на внутренние ссылки — URL меняется на `/cashpulse/transactions`
      и т.д. (с правильным префиксом)
- [ ] Сделай F5 на `/cashpulse/transactions` — страница загружается корректно
      (nginx обслуживает SPA через `try_files`)
- [ ] Перейди по прямой ссылке `/cashpulse/transactions` — приложение
      рендерит правильный роут (не 404 внутри приложения)

### Работа внутри shell (iframe)

- [ ] Открой `https://mvv42.ru/?app=cashpulse` — сервис загружается в iframe
- [ ] Навигация внутри сервиса не ломает iframe (нет 404, нет редиректа на `/`)
- [ ] Если реализован postMessage: добавь в консоли shell
      `window.addEventListener('message', e => console.log(e.data))` и
      проверь, что сообщения приходят при навигации

### Standalone режим

- [ ] Открой сервис напрямую (без shell) — всё работает
- [ ] postMessage не вызывается в standalone (нет ошибок в консоли)

### Edge cases

- [ ] Deep link: открой `/cashpulse/settings/profile` напрямую — загружается
      нужный роут
- [ ] Браузерные кнопки "назад/вперёд" работают корректно внутри iframe
- [ ] Нет дублирования basename в путях (`/cashpulse/cashpulse/...`)

---

## Итоговый минимум изменений

Если сервис на Vite + React Router v6, достаточно двух правок:

**1. `vite.config.ts`:**
```ts
export default defineConfig({
  base: '/cashpulse/', // добавить эту строку
  // ...остальное без изменений
});
```

**2. Точка входа роутера (`src/main.tsx` или `src/App.tsx`):**
```tsx
// BrowserRouter:
<BrowserRouter basename={import.meta.env.BASE_URL}>

// или createBrowserRouter:
createBrowserRouter(routes, { basename: import.meta.env.BASE_URL })
```

Всё остальное (postMessage, определение iframe) — опциональные улучшения UX.
