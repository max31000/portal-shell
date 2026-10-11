import type { CSSProperties } from 'react';
import { resolveIcon } from './icons';
import classes from './AppIcon.module.css';

const NEUTRAL = '#71717a';

interface AppIconProps {
  icon?: string;
  name: string;
  color?: string;
  /** Tile edge in px. */
  size?: number;
  className?: string;
}

/** Squircle tile with the service colour; the only place a service colour appears in the shell. */
export function AppIcon({ icon, name, color, size = 48, className }: AppIconProps) {
  const content = resolveIcon(icon, name);
  const style = {
    '--tile-size': `${size}px`,
    '--tile-color': color || NEUTRAL,
  } as CSSProperties;

  return (
    <span
      className={className ? `${classes.tile} ${className}` : classes.tile}
      style={style}
      aria-hidden="true"
      data-kind={content.kind}
    >
      {content.kind === 'tabler' ? (
        <content.Icon size={Math.round(size * 0.52)} stroke={1.75} />
      ) : (
        <span className={classes.letter}>{content.text}</span>
      )}
    </span>
  );
}
