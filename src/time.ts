import { t } from './i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago". */
export function formatAgo(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return t('timeJustNow');
  if (elapsed < HOUR) return t('timeMinutes', String(Math.floor(elapsed / MINUTE)));
  if (elapsed < DAY) return t('timeHours', String(Math.floor(elapsed / HOUR)));
  return t('timeDays', String(Math.floor(elapsed / DAY)));
}
