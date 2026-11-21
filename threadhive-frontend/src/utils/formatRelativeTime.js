const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_RELATIVE_DAYS = 30;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

// Compact relative time for lists: "just now", "5m ago", "2h ago", "3d ago",
// then a short date after 30 days. `now` is injectable for deterministic tests.
export function formatRelativeTime(isoString, now = Date.now()) {
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return '';

  const elapsed = now - time;
  // Also covers small clock skew that would put the time in the future.
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed <= MAX_RELATIVE_DAYS * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return dateFormatter.format(time);
}
