// Pure date logic. No React, no Firebase — so it is testable with plain node.
// This is the entire "automatic cleanup" system: filtering on fetch, no cron job.

const DAY = 86400000;

/** Parse 'YYYY-MM-DD' at local midnight. `new Date(str)` alone parses as UTC and
 *  shifts the day backwards for anyone west of Greenwich. */
export const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** First occurrence of the event at or after `from`.
 *  Non-recurring events just return their one date, even if it is in the past. */
export const occAfter = (ev, from) => {
  const d = parseDay(ev.date);
  if (!ev.yearly) return d;
  // ponytail: Feb 29 rolls to Mar 1 in common years. Fine for a birthday countdown.
  const at = (year) => new Date(year, d.getMonth(), d.getDate());
  const candidate = at(from.getFullYear());
  return candidate < startOfDay(from) ? at(from.getFullYear() + 1) : candidate;
};

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Birthdays expire the day they arrive; other events get a 7-day grace period,
 *  so a Christmas gift stays listed through the week you actually hand it over. */
export const graceDays = (ev) => (ev.birthday ? 0 : 7);

/** When a bought item stops being shown.
 *  Anchored on when the ITEM was created, not on today. That is what makes yearly
 *  events terminate: an item added in Nov 2026 for Christmas dies on 1 Jan 2027, it
 *  does not slide forward to Christmas 2027 and live forever. */
export const expiresAt = (item, ev) =>
  new Date(+occAfter(ev, parseDay(item.createdAt.slice(0, 10))) + graceDays(ev) * DAY);

/** The cleanup rule. Only ever hides items that are BOTH bought and past their event.
 *  An item with no event, or an unbought item, is never hidden. */
export const isExpired = (item, ev, bought, now = new Date()) =>
  Boolean(bought && ev && now > expiresAt(item, ev));

export const daysUntil = (date, now = new Date()) =>
  Math.round((startOfDay(date) - startOfDay(now)) / DAY);
