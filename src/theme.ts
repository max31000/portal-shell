import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Zinc-like neutral scale; the shell accent is neutral (spec §3.2). */
const zinc: MantineColorsTuple = [
  '#fafafa',
  '#f4f4f5',
  '#e4e4e7',
  '#d4d4d8',
  '#a1a1aa',
  '#71717a',
  '#52525b',
  '#3f3f46',
  '#27272a',
  '#18181b',
];

/** Dark surfaces aligned with tokens.css (#0b0b0c bg, #161618 surface). */
const dark: MantineColorsTuple = [
  '#e4e4e7',
  '#a1a1aa',
  '#8b8b94',
  '#52525b',
  '#2a2a2e',
  '#222225',
  '#1d1d20',
  '#161618',
  '#0f0f10',
  '#0b0b0c',
];

export const theme = createTheme({
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: {
    fontFamily: 'var(--font-sans)',
    fontWeight: '650',
  },
  colors: { zinc, dark },
  primaryColor: 'zinc',
  primaryShade: { light: 9, dark: 0 },
  autoContrast: true,
  defaultRadius: 'sm',
  radius: {
    xs: '6px',
    sm: 'var(--r-sm)',
    md: 'var(--r-md)',
    lg: 'var(--r-lg)',
    xl: 'var(--r-lg)',
  },
  fontSizes: {
    xs: 'var(--fs-12)',
    sm: 'var(--fs-13)',
    md: 'var(--fs-15)',
    lg: 'var(--fs-17)',
    xl: 'var(--fs-22)',
  },
  shadows: {
    xs: 'var(--shadow-xs)',
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)',
    xl: 'var(--shadow-lg)',
  },
  cursorType: 'pointer',
  focusRing: 'never',
  respectReducedMotion: true,
});
