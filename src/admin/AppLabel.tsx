import { AppIcon } from '../components/AppIcon';
import type { Service } from '../types';
import { LOGIN_ONLY_LABEL } from './format';
import classes from './Admin.module.css';

interface AppLabelProps {
  /** null — no service (a login-only invite): neutral tile + «Только вход». */
  appId: string | null;
  /** Name from the admin API (falls back to the registry, then the id). */
  name?: string;
  services: Service[];
  size?: number;
  /** Show the app id under the name. */
  withId?: boolean;
}

/** Service tile + name, using the registry for icon and colour (auth knows only id and name). */
export function AppLabel({ appId, name, services, size = 28, withId = false }: AppLabelProps) {
  if (appId === null) {
    return (
      <span className={classes.who}>
        <AppIcon icon="home" name={LOGIN_ONLY_LABEL} size={size} />
        <span className={classes.whoText}>
          <span className={`${classes.whoName} ${classes.muted}`}>{LOGIN_ONLY_LABEL}</span>
        </span>
      </span>
    );
  }
  const service = services.find((s) => s.id === appId);
  const title = name || service?.name || appId;
  return (
    <span className={classes.who}>
      <AppIcon icon={service?.icon} name={title} color={service?.color} size={size} />
      <span className={classes.whoText}>
        <span className={classes.whoName}>{title}</span>
        {withId && <span className={`${classes.whoSub} ${classes.mono}`}>{appId}</span>}
      </span>
    </span>
  );
}
