import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconHome, IconLock } from '@tabler/icons-react';
import type { Service } from '../types';
import { AppIcon } from './AppIcon';
import classes from './AppLauncher.module.css';
import ui from './ui.module.css';

const COLS = 3;

interface AppLauncherProps {
  services: Service[];
  activeId: string | null;
  /** `null` means «Главная». */
  onSelect: (service: Service | null) => void;
  /** Locked tiles are shown with a lock badge; selecting one calls `onLockedSelect` instead. */
  isLocked?: (service: Service) => boolean;
  onLockedSelect?: (service: Service) => void;
}

interface Position {
  top: number;
  right: number;
}

function DotsIcon() {
  // 3×3 grid of dots, drawn to sit on the same 18px optical box as Tabler icons.
  const dots = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      dots.push(<circle key={`${r}${c}`} cx={3 + c * 6} cy={3 + r * 6} r={1.6} />);
    }
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      {dots}
    </svg>
  );
}

export function AppLauncher({ services, activeId, onSelect, isLocked, onLockedSelect }: AppLauncherProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [pos, setPos] = useState<Position>({ top: 60, right: 12 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const count = services.length + 1; // + «Главная»

  const measure = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
  }, []);

  const openMenu = useCallback(() => {
    measure();
    setFocusIndex(0);
    setOpen(true);
  }, [measure]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // Move DOM focus with the roving index while open.
  useLayoutEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    function onResize() {
      measure();
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, measure, close]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = focusIndex;
    switch (e.key) {
      case 'ArrowRight':
        next = Math.min(count - 1, focusIndex + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, focusIndex - 1);
        break;
      case 'ArrowDown':
        next = focusIndex + COLS < count ? focusIndex + COLS : focusIndex;
        break;
      case 'ArrowUp':
        next = focusIndex - COLS >= 0 ? focusIndex - COLS : focusIndex;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Tab':
        e.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    e.preventDefault();
    setFocusIndex(next);
  }

  function choose(service: Service | null) {
    if (service && isLocked?.(service)) {
      close(false);
      onLockedSelect?.(service);
      return;
    }
    close(false);
    onSelect(service);
  }

  const items: (Service | null)[] = [null, ...services];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={ui.iconButton}
        aria-label="Сервисы"
        title="Сервисы"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
      >
        <DotsIcon />
      </button>

      {open &&
        createPortal(
          <>
            <div
              className={classes.backdrop}
              data-testid="launcher-backdrop"
              onMouseDown={(e) => {
                e.preventDefault();
                close(true);
              }}
            />
            <div
              id={menuId}
              role="menu"
              aria-label="Сервисы"
              className={classes.panel}
              style={{ '--pop-top': `${pos.top}px`, '--pop-right': `${pos.right}px` } as CSSProperties}
              onKeyDown={onMenuKeyDown}
            >
              <div className={classes.handle} aria-hidden="true" />
              <div className={classes.grid}>
                {items.map((service, i) => {
                  const locked = service ? !!isLocked?.(service) : false;
                  const current = service ? service.id === activeId : activeId === null;
                  return (
                    <button
                      key={service?.id ?? '__home'}
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={i === focusIndex ? 0 : -1}
                      className={classes.item}
                      aria-current={current ? 'page' : undefined}
                      aria-disabled={locked || undefined}
                      title={locked ? 'Нужен доступ' : service?.description}
                      onClick={() => choose(service)}
                    >
                      <span className={classes.iconWrap}>
                        {service ? (
                          <AppIcon icon={service.icon} name={service.name} color={service.color} size={48} />
                        ) : (
                          <span className={classes.homeTile} aria-hidden="true">
                            <IconHome size={24} stroke={1.75} />
                          </span>
                        )}
                        {locked && (
                          <span className={classes.lock} aria-hidden="true">
                            <IconLock size={10} stroke={2.25} />
                          </span>
                        )}
                      </span>
                      <span className={classes.label}>{service ? service.name : 'Главная'}</span>
                      {locked && <span className="visually-hidden">, нужен доступ</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
