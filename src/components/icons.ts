import {
  IconBook,
  IconBriefcase,
  IconBuildingBank,
  IconCalculator,
  IconCalendar,
  IconCash,
  IconChartAreaLine,
  IconChartBar,
  IconChartCandle,
  IconChartDonut,
  IconChartLine,
  IconChartPie,
  IconCoins,
  IconHome,
  IconHomeDollar,
  IconListCheck,
  IconNotes,
  IconPercentage,
  IconPiano,
  IconPigMoney,
  IconReceipt,
  IconReportMoney,
  IconSettings,
  IconShieldLock,
  IconTrendingUp,
  IconUsers,
  IconWallet,
  IconWorld,
  type Icon,
} from '@tabler/icons-react';
/**
 * Explicit allow-list of Tabler icons usable from registry.json (`"icon": "<tabler-name>"`).
 * Kept explicit so the bundle stays small; add names here when a new app needs one.
 */
export const ICONS: Record<string, Icon> = {
  book: IconBook,
  briefcase: IconBriefcase,
  'building-bank': IconBuildingBank,
  calculator: IconCalculator,
  calendar: IconCalendar,
  cash: IconCash,
  'chart-area-line': IconChartAreaLine,
  'chart-bar': IconChartBar,
  'chart-candle': IconChartCandle,
  'chart-donut': IconChartDonut,
  'chart-line': IconChartLine,
  'chart-pie': IconChartPie,
  coins: IconCoins,
  home: IconHome,
  'home-dollar': IconHomeDollar,
  'list-check': IconListCheck,
  notes: IconNotes,
  percentage: IconPercentage,
  piano: IconPiano,
  'pig-money': IconPigMoney,
  receipt: IconReceipt,
  'report-money': IconReportMoney,
  settings: IconSettings,
  'shield-lock': IconShieldLock,
  'trending-up': IconTrendingUp,
  users: IconUsers,
  wallet: IconWallet,
  world: IconWorld,
};

export type IconContent =
  | { kind: 'tabler'; Icon: Icon }
  | { kind: 'text'; text: string };

/** Decide what to draw: a known Tabler icon, a legacy emoji, or the name's first letter. */
export function resolveIcon(icon: string | undefined, name: string): IconContent {
  const key = (icon ?? '').trim();
  const Found = ICONS[key];
  if (Found) return { kind: 'tabler', Icon: Found };
  // Legacy registry entries used emoji; render them as text.
  if (key && !/^[a-z0-9-]+$/i.test(key) && [...key].length <= 4) {
    return { kind: 'text', text: key };
  }
  const letter = [...name.trim()][0] ?? '?';
  return { kind: 'text', text: letter.toUpperCase() };
}
