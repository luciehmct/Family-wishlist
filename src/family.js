// The whole user directory. Create the accounts in Firebase console →
// Authentication → Users → Add user, then paste each UID here.
// ponytail: 4 rows that change once a decade do not need a database table.
//
// Birthdays are DD/MM — no year. The countdown only needs the day and month.
export const FAMILY = [
  { uid: 'GLSHSRRKJKc152ZeTqIcXz7Mwhv1', name: 'Lucie', birthday: '29/11' },
  { uid: 'REd5x39YewUjikDrsuJBCdxKd822', name: 'Sylvie', birthday: '15/05' },
  { uid: 'SFRUEZ62OrOCvhA9FbadYemXD2u2', name: 'Jeanne', birthday: '15/02' },
  { uid: '2crOvlXlmJQFgUauv0sSR6P0NX32', name: 'Léon', birthday: '22/08' },
];

// Two people sharing a uid would silently merge them: same list, and whoever logs in
// second is treated as the first — including the "is this my own item" check that
// hides bought tags. That is a surprise leak, so fail loudly at startup instead.
if (new Set(FAMILY.map((f) => f.uid)).size !== FAMILY.length) {
  throw new Error('family.js: two entries share a uid — each person needs their own.');
}

// Guests: people who can't log in (a baby, a grandparent, a partner) but whom the family
// still buys for. They live in Firestore because they're added from the app, not by editing
// a file. ponytail: a module-level mirror instead of threading a context through every
// component — Board re-renders the whole tree when the snapshot changes anyway.
const GUESTS = new Map();
export const setGuests = (rows) => {
  GUESTS.clear();
  rows.forEach((g) => GUESTS.set(g.id, g.name));
};

export const nameOf = (uid) =>
  FAMILY.find((f) => f.uid === uid)?.name ?? GUESTS.get(uid) ?? 'Quelqu’un';

/** 'DD/MM' → the 'YYYY-MM-DD' shape the rest of the app uses. The year is a filler:
 *  birthday events are always yearly, so occAfter() replaces it with the real one. */
export const fromDDMM = (ddmm) => {
  const [d, m] = ddmm.split('/');
  if (!/^\d{2}\/\d{2}$/.test(ddmm) || +m < 1 || +m > 12 || +d < 1 || +d > 31) {
    throw new Error(`Birthday must be DD/MM, got "${ddmm}"`);
  }
  return `2000-${m}-${d}`; // 2000 is a leap year, so 29/02 survives the round-trip
};
