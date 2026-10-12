import { AppIcon } from '../components/AppIcon';
import type { Service } from '../types';
import classes from './Admin.module.css';

interface AppLabelProps {
  appId: string;
  /** Name from the admin API (falls back to the registry, then the id). */
  name?: string;
  services: Service[];
  size?: number;
  /** Show the app id under the name. */
  withId?: boolean;
}

/** Service tile + name, using the registry for icon and colour (auth knows only id and name). */
export function AppLabel({ appId, name, services, size = 28, withId = false }: AppLabelProps) {
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
