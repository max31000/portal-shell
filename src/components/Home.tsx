import type { CSSProperties, MouseEvent } from 'react';
import { IconArrowUpRight, IconLock } from '@tabler/icons-react';
import type { Service } from '../types';
import { AppIcon } from './AppIcon';
import classes from './Home.module.css';

interface HomeProps {
  services: Service[];
  onSelect: (service: Service) => void;
  isLocked?: (service: Service) => boolean;
  onLockedSelect?: (service: Service) => void;
}

function isPlainClick(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function Home({ services, onSelect, isLocked, onLockedSelect }: HomeProps) {
  return (
    <div className={classes.scroll}>
      <div className={classes.backdrop} aria-hidden="true" />
      <main className={classes.page}>
        <header className={classes.hero}>
          <p className={classes.eyebrow}>mvv42.ru</p>
          <h1 className={classes.title}>Сервисы</h1>
          <p className={classes.subtitle}>Личные инструменты для денег, расчётов и аналитики — в одном окне.</p>
        </header>

        <section aria-label="Сервисы">
          <ul className={classes.grid}>
            {services.map((service, i) => {
              const locked = !!isLocked?.(service);
              return (
                <li key={service.id} className={classes.cell} style={{ '--i': i } as CSSProperties}>
                  <a
                    href={`#/${service.id}`}
                    className={classes.card}
                    aria-disabled={locked || undefined}
                    onClick={(e) => {
                      if (!isPlainClick(e)) return;
                      e.preventDefault();
                      if (locked) onLockedSelect?.(service);
                      else onSelect(service);
                    }}
                  >
                    <div className={classes.cardTop}>
                      <AppIcon icon={service.icon} name={service.name} color={service.color} size={44} />
                      {locked ? (
                        <span className={classes.badge}>
                          <IconLock size={12} stroke={2} aria-hidden="true" />
                          Нужен доступ
                        </span>
                      ) : (
                        <IconArrowUpRight className={classes.arrow} size={18} stroke={1.75} aria-hidden="true" />
                      )}
                    </div>
                    <div className={classes.cardBody}>
                      <h2 className={classes.cardTitle}>{service.name}</h2>
                      {service.description && <p className={classes.cardText}>{service.description}</p>}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
