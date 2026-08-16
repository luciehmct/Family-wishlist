import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { FAMILY, fromDDMM, nameOf, setGuests } from './family';
import { daysUntil, isExpired, occAfter } from './logic';

/* ---------------------------------------------------------------- auth ---- */

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

/* ---------------------------------------------------------------- data ---- */

/** Live array from a Firestore collection or query. */
function useLive(ref) {
  const [rows, setRows] = useState([]);
  useEffect(
    () => onSnapshot(ref, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  return rows;
}

/** Live query filtered to everything that is NOT about me. Used for both secret
 *  collections: the server refuses to send my own rows, so they cannot leak. */
function useNotMine(name, uid, map) {
  const q = useMemo(() => query(collection(db, name), where('ownerUid', '!=', uid)), [name, uid]);
  const [rows, setRows] = useState(() => (map ? new Map() : []));
  useEffect(
    () => onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => [d.id, d.data()]);
      setRows(map ? new Map(docs) : docs.map(([id, data]) => ({ id, ...data })));
    }),
    [q, map]
  );
  return rows;
}

/**
 * DELIVERABLE #3 — an owner never sees their own bought status.
 *
 * Not a UI filter. The query asks only for purchases on OTHER people's gifts, and
 * firestore.rules refuses to serve any purchase doc whose ownerUid is the caller. The
 * data never reaches the owner's browser: no devtools, no network tab, and no bug in a
 * component below can leak it. The Map returned here is structurally incapable of
 * containing one of your own gift ids.
 */
const usePurchases = (uid) => useNotMine('purchases', uid, true);

/** Gift ideas other people added to someone else's list — never to mine. */
const useIdeas = (uid) => useNotMine('ideas', uid, false);

/** Comments under a gift — never on my own gifts, so they can't spoil anything. */
const useComments = (uid) => useNotMine('comments', uid, false);

const pRef = (gift) => doc(db, 'purchases', gift.id);

/** Everything that writes a purchase doc goes through here. `next` is the new state;
 *  a doc with nobody in it and nothing bought is deleted rather than left as a tombstone. */
const savePurchase = (gift, next) =>
  next.bought || next.participants.length
    ? setDoc(pRef(gift), { ownerUid: gift.ownerUid, ...next })
    : deleteDoc(pRef(gift));

const setBought = (gift, p, me, bought) => {
  const was = p?.participants ?? [];
  return savePurchase(gift, bought
    ? { bought: true, participants: was.includes(me) ? was : [...was, me] }
    : { bought: false, participants: was.filter((u) => u !== me) });
};

const setParticipating = (gift, p, me, joining) =>
  savePurchase(gift, {
    bought: p?.bought ?? false,
    participants: joining
      ? [...(p?.participants ?? []), me]
      : (p?.participants ?? []).filter((u) => u !== me),
  });

/* -------------------------------------------------------------- events ---- */

/** Birthdays are derived from the member list (family + guests), not stored as events. */
const birthdayEvents = (members) =>
  members
    .filter((m) => m.birthday)
    .map((m) => ({
      id: `bday:${m.uid}`,
      name: `Anniversaire de ${m.name}`,
      date: fromDDMM(m.birthday),
      userUid: m.uid,
      yearly: true,
      birthday: true,
    }));

/* ------------------------------------------------------------- theming ---- */

/** Personal, per-device taste — localStorage, not Firestore: nobody else's business. */
const THEME_DEFAULTS = { mode: 'system', done: '#059669', todo: '#d97706' };
const loadTheme = () => ({ ...THEME_DEFAULTS, ...JSON.parse(localStorage.getItem('theme') || '{}') });

const applyTheme = (t) => {
  const root = document.documentElement;
  root.classList.toggle('dark',
    t.mode === 'dark' || (t.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
  root.style.setProperty('--accent-done', t.done);
  root.style.setProperty('--accent-todo', t.todo);
  localStorage.setItem('theme', JSON.stringify(t));
};

// Applied at import so the login screen is already themed. ponytail: no listener on
// prefers-color-scheme — the OS switching mid-session is fixed by a reload.
applyTheme(loadTheme());

/* ------------------------------------------------------------ elements ---- */

const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40';
const primary = `${btn} bg-neutral-900 text-white hover:bg-neutral-700`;
const ghost = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100`;
const input =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900';
const tag = 'rounded-full px-2 py-0.5';
const menuItem = 'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100';

/** ponytail: <details> is a menu that closes itself — no open state, no click-outside
 *  listener, no popover library. */
const closeMenu = (e) => { e.currentTarget.closest('details').open = false; };

function Menu({ children }) {
  return (
    <details className="relative shrink-0">
      <summary className={`${ghost} cursor-pointer list-none px-2`} aria-label="Actions">…</summary>
      <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg">
        {children}
      </div>
    </details>
  );
}

/** Who suggested this — two letters instead of a sentence, so it fits a narrow column. */
function Initials({ uid }) {
  const name = nameOf(uid);
  return (
    <span title={`Idée de ${name}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // ponytail: the browser already knows what a valid address looks like — checkValidity()
  // on a type="email" field beats hand-rolling a regex.
  const [validEmail, setValidEmail] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      setError('Mauvais email ou mot de passe.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch {
      // Deliberately vague: saying "no such account" would tell a stranger who has one.
      setError('Impossible d’envoyer le lien. Vérifie l’adresse.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
          <p className="mt-1 text-sm text-neutral-500">Connecte-toi pour continuer.</p>
        </div>
        <input
          className={input} type="email" required autoComplete="username"
          placeholder="Email" value={email}
          onChange={(e) => { setEmail(e.target.value); setValidEmail(e.target.checkValidity()); setSent(false); }}
        />
        <input
          className={input} type="password" required autoComplete="current-password"
          placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className={`${primary} w-full`} disabled={busy}>
          {busy ? 'Connexion en cours…' : 'Se connecter'}
        </button>

        {/* Only offered once the address is a real one — nothing to click before that. */}
        {validEmail && (sent ? (
          <p className="text-sm text-neutral-500">
            Lien envoyé à {email.trim()}. Regarde tes mails (et les spams).
          </p>
        ) : (
          <button type="button" onClick={reset} disabled={busy}
            className="w-full text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-900">
            Réinitialiser mon mot de passe
          </button>
        ))}
      </form>
    </div>
  );
}

/** Adding to my own list writes to `items` (public). Adding to someone else's writes to
 *  `ideas`, which that person cannot read — that is the whole "secret suggestion". */
function GiftForm({ ownerUid, me, events, gift, onDone }) {
  const secret = ownerUid !== me;
  const [f, setF] = useState({
    title: gift?.title ?? '', url: gift?.url ?? '',
    price: gift?.price ?? '', note: gift?.note ?? '', eventId: gift?.eventId ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    const name = secret ? 'ideas' : 'items';
    const data = { ...f, title: f.title.trim(), ownerUid, ...(secret && { by: me }) };
    if (gift) await updateDoc(doc(db, name, gift.id), data);
    else await addDoc(collection(db, name), { ...data, createdAt: new Date().toISOString() });
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-neutral-300 p-4">
      {secret && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          💡 Idée cadeau pour {nameOf(ownerUid)}. C'est pour éviter d’acheter deux fois la même chose.
        </p>
      )}
      <input className={input} placeholder="Quoi ?" value={f.title}
        onChange={set('title')} autoFocus required />
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={input} type="url" placeholder="Lien (facultatif)"
          value={f.url} onChange={set('url')} />
        <input className={input} placeholder="Prix (facultatif)"
          value={f.price} onChange={set('price')} />
      </div>
      <input className={input} placeholder="Note — taille, couleur, modèle… (facultatif)"
        value={f.note} onChange={set('note')} />
      <select className={input} value={f.eventId} onChange={set('eventId')}>
        <option value="">Pas d’occasion</option>
        {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <div className="flex gap-2">
        <button className={primary}>{gift ? 'Enregistrer' : 'Ajouter'}</button>
        <button type="button" className={ghost} onClick={onDone}>Annuler</button>
      </div>
    </form>
  );
}

/** Comment thread under someone else's gift: "quelqu'un veut participer ?". */
function Thread({ gift, comments, me }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await addDoc(collection(db, 'comments'), {
      giftId: gift.id, ownerUid: gift.ownerUid, by: me,
      text: text.trim(), createdAt: new Date().toISOString(),
    });
    setText('');
  };

  const sorted = [...comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  return (
    <div className="mt-3 space-y-1 border-t border-neutral-200 pt-2 text-xs">
      {sorted.map((c) => (
        <p key={c.id} className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{nameOf(c.by)}</span>{' '}
            <span className="text-neutral-600">{c.text}</span>
          </span>
          {c.by === me && (
            <button className="shrink-0 text-neutral-400 hover:text-red-600"
              onClick={() => deleteDoc(doc(db, 'comments', c.id))} aria-label="Supprimer">
              ✕
            </button>
          )}
        </p>
      ))}
      {open ? (
        <form onSubmit={send} className="flex gap-2 pt-1">
          <input className={`${input} py-1 text-xs`} placeholder="Un mot aux autres…" autoFocus
            value={text} onChange={(e) => setText(e.target.value)} />
          <button className={`${primary} px-2 py-1 text-xs`}>Envoyer</button>
        </form>
      ) : (
        <button className="text-neutral-500 underline underline-offset-4 hover:text-neutral-900"
          onClick={() => setOpen(true)}>
          💬 Commenter
        </button>
      )}
    </div>
  );
}

function Gift({ gift, event, events, p, me, showBought, comments = [] }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <GiftForm ownerUid={gift.ownerUid} me={me} events={events} gift={gift}
      onDone={() => setEditing(false)} />;
  }

  const theirs = gift.ownerUid !== me;
  const canEdit = gift.secret ? gift.by === me : gift.ownerUid === me;
  const bought = showBought && p?.bought;
  const people = (showBought && p?.participants) || [];
  const inIt = people.includes(me);

  return (
    <li className={`rounded-xl border p-4 transition-colors ${
      bought ? 'border-neutral-200 bg-neutral-100' : 'border-neutral-300 bg-white'}`}>
      <div className="flex items-start gap-3">
        {gift.secret && <Initials uid={gift.by} />}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium break-words">
            {gift.url
              ? <a href={gift.url} target="_blank" rel="noreferrer" className="underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900">{gift.title}</a>
              : gift.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            {gift.price && <span>{gift.price}</span>}
            {event && <span className={`${tag} bg-neutral-100`}>{event.name}</span>}
            {bought && (
              <span className={`${tag} bg-neutral-900 font-medium text-white`}>Acheté</span>
            )}
            {people.length > 0 && (
              <span className={`${tag} bg-emerald-100 font-medium text-emerald-900`}>
                🤝 {people.map(nameOf).join(', ')}
              </span>
            )}
          </div>
          {gift.note && <p className="mt-2 text-sm text-neutral-600">{gift.note}</p>}
        </div>
        {canEdit && (
          <Menu>
            <button className={menuItem} onClick={(e) => { closeMenu(e); setEditing(true); }}>
              Modifier
            </button>
            <button className={`${menuItem} text-red-600`}
              onClick={(e) => { closeMenu(e); deleteDoc(doc(db, gift.secret ? 'ideas' : 'items', gift.id)); }}>
              Supprimer
            </button>
          </Menu>
        )}
      </div>

      {/* In privacy mode the buttons go too, not just the badges: an "Annuler"
          label is as much of a spoiler as the "Acheté" tag it replaces. */}
      {theirs && showBought && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={inIt ? ghost : `${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
              onClick={() => setParticipating(gift, p, me, !inIt)}
              title={inIt ? 'Se retirer de la cagnotte' : 'Partager le prix avec les autres'}>
              {inIt ? 'Je me retire' : 'Je veux participer !'}
            </button>
            <button className={p?.bought ? ghost : primary}
              onClick={() => setBought(gift, p, me, !p?.bought)}
              title="Invisible pour la personne concernée">
              {p?.bought ? 'Annuler' : 'Acheté'}
            </button>
          </div>
          <Thread gift={gift} comments={comments} me={me} />
        </>
      )}
    </li>
  );
}

/** Every other person's list on one page, mine excluded (it lives on Accueil). */
function Lists({ me, members, gifts, purchases, comments, events, eventById, now, privacy }) {
  const [adding, setAdding] = useState(null); // uid of the list being added to

  // Automatic cleanup: bought gifts drop off once their occasion has passed. The filter
  // uses the REAL bought flag, never the privacy-masked one, so flipping the eye toggle
  // can't change the length of a list — which would itself leak.
  const listOf = (uid, show) => gifts
    .filter((g) => g.ownerUid === uid)
    // Suggested ideas are gift planning like everything else: gone when the eye is closed.
    .filter((g) => show || !g.secret)
    .filter((g) => !isExpired(g, eventById(g.eventId), Boolean(purchases.get(g.id)?.bought), now))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    // One column per person, side by side; stacks on a phone. ponytail: grid-flow-col
    // with an explicit count would overflow past 3-4 people — auto-fit keeps it readable.
    <div className="space-y-8">
      <div className="grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const show = !privacy || m.guest;
          const list = listOf(m.uid, show);
          return (
            <section key={m.uid} className="space-y-3 rounded-xl bg-white/60 p-3">
              <div className="flex items-center justify-between gap-2 border-b border-neutral-200 pb-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {m.name}
                  {m.guest}
                </h2>
                {show && adding !== m.uid && (
                  <button className={ghost} onClick={() => setAdding(m.uid)}>+ Idée</button>
                )}
              </div>
              {adding === m.uid && (
                <GiftForm ownerUid={m.uid} me={me} events={events} onDone={() => setAdding(null)} />
              )}
              {list.length === 0 ? (
                <p className="text-sm text-neutral-400">Rien pour le moment.</p>
              ) : (
                <ul className="grid gap-3">
                  {list.map((g) => (
                    <Gift key={g.id} gift={g} event={eventById(g.eventId)} events={events}
                      p={purchases.get(g.id)} me={me} showBought={show}
                      comments={comments.filter((c) => c.giftId === g.id)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** People without a Firebase account. Nobody logs in as them, so nothing is hidden on
 *  their list — the whole family sees the ideas and who's buying what. */
function GuestFields({ init, label, onSubmit, onCancel }) {
  const [f, setF] = useState({ name: init?.name ?? '', birthday: init?.birthday ?? '' });
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSubmit({ ...f, name: f.name.trim() }); }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={input} placeholder="Prénom" value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input className={input} placeholder="Anniversaire JJ/MM (facultatif)"
          pattern="\d{2}/\d{2}" value={f.birthday}
          onChange={(e) => setF({ ...f, birthday: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <button className={primary}>{label}</button>
        {onCancel && <button type="button" className={ghost} onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}

function Guests({ guests }) {
  const [editing, setEditing] = useState(null);

  const remove = (g) => {
    // ponytail: idea/purchase docs pointing at a deleted guest are simply never rendered
    // again. Cleaning them up would need a batch write for a once-a-year action.
    if (confirm(`Supprimer ${g.name} ? Les idées ajoutées pour cette personne disparaîtront.`)) {
      deleteDoc(doc(db, 'guests', g.id));
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-neutral-300 p-4">
      <div>
        <p className="text-sm font-medium">Personnes sans compte</p>
        <p className="text-xs text-neutral-500">
          Pour offrir à quelqu’un qui n’utilise pas l’app. Sa liste est visible par tout le monde.
        </p>
      </div>

      {guests.length > 0 && (
        <ul className="divide-y divide-neutral-200">
          {guests.map((g) => (
            <li key={g.id} className="py-2">
              {editing === g.id ? (
                <GuestFields init={g} label="Enregistrer" onCancel={() => setEditing(null)}
                  onSubmit={async (data) => {
                    await updateDoc(doc(db, 'guests', g.id), data);
                    setEditing(null);
                  }} />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    {g.name}
                    {g.birthday && <span className="text-neutral-500"> · {g.birthday}</span>}
                  </span>
                  <Menu>
                    <button type="button" className={menuItem}
                      onClick={(e) => { closeMenu(e); setEditing(g.id); }}>
                      Modifier
                    </button>
                    <button type="button" className={`${menuItem} text-red-600`}
                      onClick={(e) => { closeMenu(e); remove(g); }}>
                      Supprimer
                    </button>
                  </Menu>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* key: remounting on success is the cheapest way to clear the fields */}
      <GuestFields key={guests.length} label="Ajouter une personne"
        onSubmit={(data) => addDoc(collection(db, 'guests'), data)} />
    </div>
  );
}

const byDate = (now) => (a, b) => daysUntil(occAfter(a, now), now) - daysUntil(occAfter(b, now), now);

/** Read-only countdown column on Accueil, colour-coded by whether anything is bought. */
function Countdowns({ events, now, status }) {
  const skin = {
    // green = something is already bought for that occasion, amber = still nothing.
    done: 'border-emerald-300 bg-emerald-50',
    todo: 'border-amber-300 bg-amber-50',
    // no colour at all when the answer would be about me, or when the eye is closed:
    // "nothing bought yet" is itself a spoiler.
    none: 'border-neutral-300 bg-white',
  };

  return (
    <ul className="space-y-3">
      {[...events].sort(byDate(now)).map((e) => {
        const days = daysUntil(occAfter(e, now), now);
        return (
          <li key={e.id} className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${skin[status(e)]}`}>
            <div className="min-w-0">
              <p className="truncate font-medium">{e.name}</p>
              <p className="text-xs text-neutral-500">{occAfter(e, now).toLocaleDateString()}</p>
            </div>
            <span className="shrink-0 text-right">
              <span className="block text-xl font-semibold tabular-nums">{days}</span>
              <span className="text-xs text-neutral-500">{days === 0 ? 'aujourd’hui' : 'jours'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Appearance({ theme, setTheme }) {
  const swatch = 'h-9 w-14 cursor-pointer rounded-lg border border-neutral-300 bg-transparent p-1';
  const modes = [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']];
  const colors = [
    ['done', 'Acheté / participation', 'countdowns verts, badges, bouton participer'],
    ['todo', 'En attente / idées', 'countdowns sans cadeau, idées, mode caché'],
  ];

  return (
    <div className="space-y-4 rounded-xl border border-neutral-300 p-4">
      <p className="text-sm font-medium">Apparence</p>

      <div className="flex flex-wrap gap-2">
        {modes.map(([m, label]) => (
          <button key={m} className={theme.mode === m ? primary : ghost}
            onClick={() => setTheme({ ...theme, mode: m })}>
            {label}
          </button>
        ))}
      </div>

      {colors.map(([k, label, hint]) => (
        <label key={k} className="flex items-center gap-3">
          <input type="color" className={swatch} value={theme[k]}
            onChange={(e) => setTheme({ ...theme, [k]: e.target.value })} />
          <span className="text-sm">
            {label}
            <span className="block text-xs text-neutral-500">{hint}</span>
          </span>
        </label>
      ))}

      <button className={ghost} onClick={() => setTheme(THEME_DEFAULTS)}>
        Couleurs par défaut
      </button>
    </div>
  );
}

/** Countdown editor — Réglages. Birthdays aren't here: they come from the member list. */
function EventsSettings({ stored, members, now }) {
  const [f, setF] = useState({ name: '', date: '', userUid: '', yearly: true });

  const add = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.date) return;
    await addDoc(collection(db, 'events'), { ...f, name: f.name.trim(), birthday: false });
    setF({ name: '', date: '', userUid: '', yearly: true });
  };

  return (
    <div className="space-y-4 rounded-xl border border-neutral-300 p-4">
      <div>
        <p className="text-sm font-medium">Comptes à rebours</p>
      </div>

      {stored.length > 0 && (
        <ul className="divide-y divide-neutral-200">
          {[...stored].sort(byDate(now)).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {e.name}
                <span className="text-neutral-500">
                  {' · '}{occAfter(e, now).toLocaleDateString()}
                  {e.userUid && ` · ${nameOf(e.userUid)}`}
                  {e.yearly && ' · chaque année'}
                </span>
              </span>
              <button className={ghost} onClick={() => deleteDoc(doc(db, 'events', e.id))}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={input} placeholder="Noël, remise de diplôme…" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input className={input} type="date" value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })} required />
          <select className={input} value={f.userUid}
            onChange={(e) => setF({ ...f, userUid: e.target.value })}>
            <option value="">Tout le monde</option>
            {members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={f.yearly}
              onChange={(e) => setF({ ...f, yearly: e.target.checked })} />
            Se répète chaque année
          </label>
        </div>
        <button className={primary}>Ajouter un compte à rebours</button>
      </form>
    </div>
  );
}

/** Home tab: my own list, then every gift I'm tracking for someone else, grouped by
 *  occasion. My own gifts are absent by construction — `purchases` never sends them. */
function Dashboard({ me, gifts, purchases, comments, events, eventById, now, privacy, isGuest, children }) {
  const mine = gifts
    .filter((g) => g.ownerUid === me)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Privacy mode keeps gifts for people without an account: nobody can log in as them,
  // so there is no one in the room whose surprise this would spoil.
  const tracked = gifts
    .filter((g) => !privacy || isGuest(g.ownerUid))
    .filter((g) => purchases.has(g.id) && !isExpired(g, eventById(g.eventId), true, now));
  const groups = [...events, null]
    .map((e) => ({ e, list: tracked.filter((g) => (eventById(g.eventId) ?? null) === e) }))
    .filter((g) => g.list.length)
    .sort((a, b) => (a.e ? daysUntil(occAfter(a.e, now), now) : 1e9)
                  - (b.e ? daysUntil(occAfter(b.e, now), now) : 1e9));

  // Green once anything is bought for that occasion. Never for an event that is about me
  // (I must not learn my own status) and never while the privacy eye is closed.
  const status = (e) => {
    if (e.userUid === me) return 'none';
    if (privacy && !isGuest(e.userUid)) return 'none';
    return gifts.some((g) => g.eventId === e.id && purchases.get(g.id)?.bought
      && (!privacy || isGuest(g.ownerUid))) ? 'done' : 'todo';
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
      <aside className="space-y-3 lg:order-2">
        <h2 className="text-lg font-semibold tracking-tight">Comptes à rebours</h2>
        <Countdowns events={events} now={now} status={status} />
      </aside>

      <div className="space-y-8 lg:order-1">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Ma liste</h2>
        {children}
        {mine.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">Rien sur ta liste pour le moment.</p>
        )}
        <ul className="grid gap-3">
          {mine.map((g) => (
            <Gift key={g.id} gift={g} event={eventById(g.eventId)} events={events}
              p={undefined} me={me} showBought={false} />
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Cadeaux suivis</h2>
        {privacy && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            🙈 C'est masqué! Tu peux partager ton écran.
          </p>
        )}
        {groups.length === 0 ? (
          !privacy && (
            <p className="py-8 text-center text-sm text-neutral-400">
              Rien de réservé pour l’instant.
            </p>
          )
        ) : (
          groups.map(({ e, list }) => (
            <div key={e?.id ?? 'none'} className="space-y-2">
              <p className="text-sm font-medium text-neutral-500">
                {e ? `${e.name} · dans ${daysUntil(occAfter(e, now), now)} j` : 'Sans occasion'}
              </p>
              <ul className="grid gap-3">
                {list.map((g) => (
                  <Gift key={g.id} gift={g} event={null} events={events}
                    p={purchases.get(g.id)} me={me} showBought
                    comments={comments.filter((c) => c.giftId === g.id)} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- app ---- */

function Board({ user }) {
  const me = FAMILY.find((f) => f.uid === user.uid);
  const [tab, setTab] = useState('home');
  const [adding, setAdding] = useState(false);
  const [privacy, setPrivacy] = useState(() => localStorage.getItem('privacy') === '1');
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => applyTheme(theme), [theme]);

  const items = useLive(collection(db, 'items'));
  const storedEvents = useLive(collection(db, 'events'));
  const guests = useLive(collection(db, 'guests'));
  const ideas = useIdeas(user.uid);
  const comments = useComments(user.uid);
  const purchases = usePurchases(user.uid);

  useEffect(() => localStorage.setItem('privacy', privacy ? '1' : '0'), [privacy]);

  // Guests are members too: their doc id stands in for a uid everywhere.
  const members = useMemo(() => {
    const all = [...FAMILY, ...guests.map((g) => ({ uid: g.id, name: g.name, birthday: g.birthday, guest: true }))];
    setGuests(guests); // keeps nameOf() working for guest uids
    return all;
  }, [guests]);

  const events = useMemo(() => [...birthdayEvents(members), ...storedEvents], [members, storedEvents]);
  const eventById = (id) => events.find((e) => e.id === id) ?? null;
  const isGuest = (uid) => guests.some((g) => g.id === uid);
  const gifts = useMemo(
    () => [...items, ...ideas.map((i) => ({ ...i, secret: true }))],
    [items, ideas]
  );
  const now = new Date();

  if (!me) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-neutral-600">
          This account isn’t listed in <code>src/family.js</code>. Add its UID: <br />
          <code className="text-xs">{user.uid}</code>
        </p>
        <button className={ghost} onClick={() => signOut(auth)}>Sign out</button>
      </div>
    );
  }

  const pill = (key, label) => (
    <button key={key} onClick={() => { setTab(key); setAdding(false); }}
      className={`${btn} shrink-0 ${tab === key ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
      {label}
    </button>
  );

  const addButton = (ownerUid) =>
    adding
      ? <GiftForm ownerUid={ownerUid} me={user.uid} events={events} onDone={() => setAdding(false)} />
      : <button className={primary} onClick={() => setAdding(true)}>
          {ownerUid === user.uid ? '+ Ajouter une envie' : `+ Ajouter une idée pour ${nameOf(ownerUid)}`}
        </button>;

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <h1 className="mr-auto font-semibold tracking-tight">Wishlist</h1>
          <button
            onClick={() => setPrivacy(!privacy)}
            aria-pressed={privacy}
            aria-label={privacy ? 'Afficher les cadeaux réservés' : 'Masquer les cadeaux réservés'}
            title={privacy ? 'Masqué — tu peux partager ton écran' : 'Masquer pour partager l’écran'}
            className={`${btn} ${privacy ? 'bg-amber-100 text-amber-900' : 'text-neutral-500 hover:bg-neutral-100'}`}
          >
            {privacy ? '🙈 Masqué' : '👁 Visible'}
          </button>
          <button className={ghost} onClick={() => signOut(auth)}>Déconnexion</button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3">
          {pill('home', 'Accueil')}
          {pill('lists', 'Les listes')}
          {pill('settings', 'Réglages')}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {tab === 'home' && (
          <Dashboard me={user.uid} gifts={gifts} purchases={purchases} comments={comments} events={events}
            eventById={eventById} now={now} privacy={privacy} isGuest={isGuest}>
            {addButton(user.uid)}
          </Dashboard>
        )}
        {tab === 'lists' && (
          <Lists me={user.uid} members={members.filter((m) => m.uid !== user.uid)}
            gifts={gifts} purchases={purchases} comments={comments} events={events} eventById={eventById}
            now={now} privacy={privacy} />
        )}
        {tab === 'settings' && (
          <div className="space-y-6">
            <EventsSettings stored={storedEvents} members={members} now={now} />
            <Guests guests={guests} />
            <Appearance theme={theme} setTheme={setTheme} />
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const user = useAuth();
  if (user === undefined) return <div className="min-h-dvh bg-neutral-50" />;
  return user ? <Board user={user} /> : <Login />;
}
