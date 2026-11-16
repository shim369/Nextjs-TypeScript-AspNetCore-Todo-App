import Head from 'next/head'
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ToDoItem } from '../types/todo';
import {
  daysFromToday, fmtDate, hostOf, parseDue, prefersReducedMotion,
  safeUrl, seedTodos, store, toInputDate,
} from '../lib/todoUtils';
import { dicts, isLang, Lang, LANGS } from '../lib/i18n';

/* ===== 設定 ===== */
const API_BASE = 'http://localhost:5082/api/todo';
const STORE_KEY = 'todo-demo-items';
const THEME_KEY = 'todo-theme';
const LANG_KEY = 'todo-lang';
const RING_LEN = 226.2;

const api = axios.create({ baseURL: API_BASE, timeout: 6000 });

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Mode = 'loading' | 'api' | 'demo';
type Filter = 'all' | 'active' | 'done';
type NewItem = Pick<ToDoItem, 'title' | 'url' | 'dueDate'> & { isComplete?: boolean };
type ToastAction = { label: string; run: () => void };
type Toast = { id: number; msg: string; kind?: 'error' | 'ok'; action?: ToastAction; out?: boolean };

const FILTERS: Filter[] = ['all', 'active', 'done'];

// ?lang=ja / 保存値 から初期言語を決定(既定は英語)
const detectLang = (): Lang => {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (isLang(q)) return q;
  } catch (e) { /* ignore */ }
  const saved = store.get(LANG_KEY);
  return isLang(saved) ? saved : 'en';
};

/* ===== アニメーションする数値 ===== */
function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const from = current.current;
    if (from === value || prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - start) / 600, 1);
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      current.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

/* ===== confetti(全タスク完了時) ===== */
function runConfetti(cv: HTMLCanvasElement, origin: DOMRect) {
  if (prefersReducedMotion()) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#3b5cf7', '#7088f9', '#b9c5ff', '#ffffff', '#ffcf4d'];
  const ox = origin.left + origin.width / 2, oy = origin.top + origin.height / 2;
  const parts = Array.from({ length: 140 }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 8;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, w: 4 + Math.random() * 6, h: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[(Math.random() * colors.length) | 0], life: 0 };
  });
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    parts.forEach(p => {
      p.life++; p.vy += .22; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      if (p.y < H + 20 && p.life < 220) alive++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - p.life / 220);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life * .1)));
      ctx.restore();
    });
    if (alive) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
  };
  tick();
}

export default function Home() {
  const [lang, setLangState] = useState<Lang>('en');
  const t = dicts[lang];
  const langRef = useRef<Lang>('en');
  const [todos, setTodos] = useState<ToDoItem[]>([]);
  const [mode, setMode] = useState<Mode>('loading');
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<number | null>(null);
  const [popped, setPopped] = useState<number[]>([]);
  const [leaving, setLeaving] = useState<ToDoItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [hour, setHour] = useState<number | null>(null);
  
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLCanvasElement>(null);
  const tabRefs = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  const [ind, setInd] = useState({ w: 0, x: 0 });
  const nodeRefs = useRef(new Map<number, HTMLLIElement>());
  const prevTops = useRef(new Map<number, number>());
  const prevVisible = useRef<ToDoItem[]>([]);
  const firstRendered = useRef(false);
  const toastSeq = useRef(0);
  const editDone = useRef(false);
  useEffect(() => { if (editing !== null) editDone.current = false; }, [editing]);

  /* ===== toast ===== */
  const closeToast = useCallback((id: number) => {
    setToasts(ts => ts.map(t => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 300);
  }, []);

  const toast = useCallback((msg: string, action?: ToastAction | null, kind?: Toast['kind']) => {
    const id = ++toastSeq.current;
    setToasts(ts => [...ts, { id, msg, kind, action: action || undefined }].slice(-3));
    setTimeout(() => closeToast(id), action ? 5000 : 2800);
  }, [closeToast]);

  /* ===== data layer: API → 失敗時はブラウザ内デモ ===== */
  const fetchTodos = async () => {
    if (mode !== 'api') return;
    const { data } = await api.get<ToDoItem[]>('');
    setTodos(data);
  };

  const init = useCallback(async () => {
    setMode('loading');
    try {
      const { data } = await api.get<ToDoItem[]>('', { timeout: 3000 });
      if (!Array.isArray(data)) throw new Error('Unexpected response');
      setTodos(data);
      setMode('api');
    } catch (e) {
      let saved: ToDoItem[] | null = null;
      try {
        const v = JSON.parse(store.get(STORE_KEY) || 'null');
        if (Array.isArray(v)) saved = v;
      } catch (_) { /* ignore */ }
      setTodos(saved || seedTodos(langRef.current));
      setMode('demo');
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const l = detectLang();
    langRef.current = l;
    setLangState(l);
    init();
  }, [init]);

  const setLang = (l: Lang) => {
    langRef.current = l;
    setLangState(l);
    store.set(LANG_KEY, l);
  };

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // デモモードではブラウザに保存
  useEffect(() => {
    if (mode === 'demo') store.set(STORE_KEY, JSON.stringify(todos));
  }, [todos, mode]);

  const actions = {
    async create(item: NewItem) {
      if (mode === 'api') {
        await api.post('', { isComplete: false, ...item });
        await fetchTodos();
      } else {
        setTodos(prev => [...prev, { id: Math.max(0, ...prev.map(t => t.id)) + 1, isComplete: false, ...item }]);
      }
    },
    async update(item: ToDoItem) {
      setTodos(prev => prev.map(t => (t.id === item.id ? { ...item } : t)));
      if (mode === 'api') {
        await api.put(`/${item.id}`, item);
        await fetchTodos();
      }
    },
    async remove(id: number) {
      setTodos(prev => prev.filter(t => t.id !== id));
      if (mode === 'api') {
        await api.delete(`/${id}`);
        await fetchTodos();
      }
    },
  };

  const safely = async (fn: () => Promise<void>, errMsg?: string) => {
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(errMsg || t.errGeneric, null, 'error');
      try { await fetchTodos(); } catch (_) { /* ignore */ }
    }
  };

  /* ===== header text / 初期値(クライアントのみ) ===== */
  useEffect(() => {
    const now = new Date();
    setHour(now.getHours());
    setDueDate(toInputDate(now));
  }, []);

  /* ===== theme ===== */
  const toggleTheme = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set(THEME_KEY, next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0c0e16' : '#eeeeee');
  };

  /* ===== derived ===== */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todos
      .filter(t => filter === 'all' || (filter === 'done' ? t.isComplete : !t.isComplete))
      .filter(t => !q || (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const da = parseDue(a.dueDate), db = parseDue(b.dueDate);
        const diff = ((da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity)) || (a.id - b.id);
        return dir === 'asc' ? diff : -diff;
      });
  }, [todos, filter, query, dir]);

  const stats = useMemo(() => {
    const done = todos.filter(t => t.isComplete).length;
    let today = 0, over = 0;
    todos.forEach(t => {
      if (t.isComplete) return;
      const d = parseDue(t.dueDate);
      if (!d) return;
      const n = daysFromToday(d);
      if (n === 0) today++; else if (n < 0) over++;
    });
    return {
      all: todos.length,
      done,
      active: todos.length - done,
      today,
      over,
      pct: todos.length ? Math.round((done / todos.length) * 100) : 0,
    };
  }, [todos]);

  /* ===== 消える要素を少し残してアニメーション ===== */
  useIsoLayoutEffect(() => {
    const ids = new Set(visible.map(t => t.id));
    const gone = prevVisible.current.filter(t => !ids.has(t.id));
    prevVisible.current = visible;
    if (!gone.length || prefersReducedMotion()) return;
    const goneIds = gone.map(g => g.id);
    setLeaving(l => [...l.filter(x => goneIds.indexOf(x.id) === -1), ...gone]);
    setTimeout(() => setLeaving(l => l.filter(x => goneIds.indexOf(x.id) === -1)), 380);
  }, [visible]);

  /* ===== FLIP: 並べ替えを補間 ===== */
  useIsoLayoutEffect(() => {
    const next = new Map<number, number>();
    const reduce = prefersReducedMotion();
    visible.forEach(t => {
      const el = nodeRefs.current.get(t.id);
      if (!el) return;
      const top = el.offsetTop;
      next.set(t.id, top);
      const prev = prevTops.current.get(t.id);
      if (!reduce && prev !== undefined && Math.abs(prev - top) > 1) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    prevTops.current = next;
    if (loaded && visible.length) firstRendered.current = true;
  });

  /* ===== tabs indicator ===== */
  const moveInd = useCallback(() => {
    const b = tabRefs.current[filter];
    if (b) setInd({ w: b.offsetWidth, x: b.offsetLeft });
  }, [filter]);

  useIsoLayoutEffect(moveInd, [moveInd, stats.all, stats.active, stats.done]);
  useEffect(() => {
    window.addEventListener('resize', moveInd);
    if (document.fonts) document.fonts.ready.then(moveInd);
    return () => window.removeEventListener('resize', moveInd);
  }, [moveInd]);

  /* ===== keyboard shortcuts ===== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); titleRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ===== handlers ===== */
  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(false);
    if (!title.trim()) {
      requestAnimationFrame(() => setInvalid(true));
      titleRef.current?.focus();
      toast(t.enterTitle, null, 'error');
      return;
    }
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    const newItem: NewItem = { title: title.trim(), url: u, dueDate: dueDate || toInputDate(new Date()) };
    setSubmitting(true);
    await safely(async () => {
      await actions.create(newItem);
      setTitle(''); setUrl(''); setDueDate(toInputDate(new Date()));
      if (filter === 'done') setFilter('all');
      titleRef.current?.focus();
    }, t.errCreate);
    setSubmitting(false);
  };

  const toggleComplete = (item: ToDoItem, checked: boolean) => {
    setPopped(p => (checked ? [...p.filter(id => id !== item.id), item.id] : p.filter(id => id !== item.id)));
    const wasAllDone = todos.every(t => t.isComplete);
    const next = todos.map(t => (t.id === item.id ? { ...t, isComplete: checked } : t));
    safely(async () => {
      await actions.update({ ...item, isComplete: checked });
      if (checked && !wasAllDone && next.length && next.every(t => t.isComplete)) {
        if (confettiRef.current && ringRef.current) runConfetti(confettiRef.current, ringRef.current.getBoundingClientRect());
        toast(t.allDone, null, 'ok');
      }
    }, t.errUpdate);
  };

  const deleteToDo = (item: ToDoItem) => {
    safely(async () => {
      await actions.remove(item.id);
      toast(t.deleted(item.title), {
        label: t.undo,
        run: () => safely(() => actions.create({ title: item.title, url: item.url, dueDate: item.dueDate, isComplete: item.isComplete }), t.errRestore),
      });
    }, t.errDelete);
  };

  const clearDone = () => {
    const done = todos.filter(t => t.isComplete);
    if (!done.length) return;
    safely(async () => {
      setTodos(prev => prev.filter(t => !t.isComplete));
      if (mode === 'api') {
        for (let i = 0; i < done.length; i++) await api.delete(`/${done[i].id}`);
        await fetchTodos();
      }
      toast(t.cleared(done.length));
    }, t.errClear);
  };

  const finishEdit = (item: ToDoItem, value: string, save: boolean) => {
    if (editDone.current || editing !== item.id) return;
    editDone.current = true;
    setEditing(null);
    const v = value.trim();
    if (save && v && v !== item.title) {
      safely(() => actions.update({ ...item, title: v }), t.errRename);
    }
  };

  /* ===== render helpers ===== */
  const emptyCopy = (() => {
    if (query) return { title: t.emptyQueryTitle, text: t.emptyQueryText(query) };
    if (filter === 'done') return { title: t.emptyDoneTitle, text: t.emptyDoneText };
    if (filter === 'active' && todos.length) return { title: t.emptyCaughtTitle, text: t.emptyCaughtText };
    return { title: t.emptyTitle, text: t.emptyText };
  })();

  const visibleIds = new Set(visible.map(t => t.id));
  const rows: { t: ToDoItem; leave: boolean }[] = [
    ...visible.map(t => ({ t, leave: false })),
    ...leaving.filter(t => !visibleIds.has(t.id)).map(t => ({ t, leave: true })),
  ];

  const renderItem = (it: ToDoItem, leave: boolean, i: number) => {
    const d = parseDue(it.dueDate);
    const n = d ? daysFromToday(d) : null;
    const dueCls = n === null ? '' : n < 0 ? 'overdue' : n === 0 ? 'today' : '';
    const href = safeUrl(it.url);
    const host = href ? hostOf(href) : '';
    const label = it.title || t.untitled;
    const cls = [
      'item',
      leave ? 'leave' : 'enter',
      it.isComplete ? 'is-done' : '',
      !it.isComplete && n !== null && n < 0 ? 'is-overdue' : '',
      popped.indexOf(it.id) !== -1 ? 'pop' : '',
    ].filter(Boolean).join(' ');

    return (
      <li
        key={it.id}
        className={cls}
        style={!firstRendered.current ? { animationDelay: `${i * 55}ms` } : undefined}
        ref={el => {
          if (leave) return;
          if (el) nodeRefs.current.set(it.id, el); else nodeRefs.current.delete(it.id);
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={it.isComplete}
            onChange={e => toggleComplete(it, e.target.checked)}
            aria-label={t.markAs(it.title, it.isComplete)}
          />
          <span className="box">
            <svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </label>
        <div className="item-main">
          {d && n !== null && (
            <span className={`dueDate ${dueCls}`}>
              <time dateTime={toInputDate(d)}>{fmtDate(d, t.locale)}</time>
              <span className="rel">· {t.rel(n)}</span>
            </span>
          )}
          <div className="title-wrap">
            {editing === it.id ? (
              <input
                className="edit-input"
                defaultValue={it.title}
                aria-label={t.editTitle}
                maxLength={200}
                autoFocus
                onFocus={e => e.currentTarget.select()}
                onKeyDown={e => {
                  if (e.key === 'Enter') finishEdit(it, e.currentTarget.value, true);
                  if (e.key === 'Escape') finishEdit(it, e.currentTarget.value, false);
                }}
                onBlur={e => finishEdit(it, e.currentTarget.value, true)}
              />
            ) : (
              <>
                {href ? (
                  <a
                    className="title"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={it.title}
                    onDoubleClick={e => { e.preventDefault(); setEditing(it.id); }}
                  >{label}</a>
                ) : (
                  <span className="title" title={it.title} onDoubleClick={() => setEditing(it.id)}>{label}</span>
                )}
                {host && (
                  <a className="host" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M8 7h9v9" /></svg>
                    {host}
                  </a>
                )}
              </>
            )}
          </div>
        </div>
        <div className="item-actions">
          <button className="ghost-btn edit" type="button" aria-label={t.rename(it.title)} onClick={() => setEditing(it.id)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /></svg>
          </button>
          <button className="deleteButton" type="button" aria-label={t.del(it.title)} onClick={() => deleteToDo(it)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
            <span className="lbl">{t.deleteLbl}</span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      <Head>
        <title>{t.docTitle(stats.active)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="main">
        {/* top bar */}
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span>ToDo<small>{t.brandSub}</small></span>
          </div>
          <div className="top-actions">
            <span className="status" data-state={mode} role="status" aria-live="polite">
              <i className="dot" />
              <span>
                {mode === 'api' && <>{t.connected} <span className="label-long">{t.connectedLong}</span></>}
                {mode === 'demo' && (
                  <>{t.demo} <span className="label-long">{t.demoLong}</span>{' '}
                    <button type="button" onClick={init}>{t.retry}</button></>
                )}
                {mode === 'loading' && t.connecting}
              </span>
            </span>
            <div className="lang-switch" role="group" aria-label={t.language}>
              {LANGS.map(l => (
                <button key={l.key} type="button" aria-pressed={lang === l.key} lang={l.key} onClick={() => setLang(l.key)}>
                  {l.label}
                </button>
              ))}
            </div>
            <button className="icon-btn theme-btn" type="button" aria-label={t.toggleTheme} onClick={toggleTheme}>
              <svg className="moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
              <svg className="sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            </button>
          </div>
        </div>

        {/* hero */}
        <section className="hero">
          <div className="hero-text">
            <p className="hello">{hour === null ? '\u00a0' : t.greeting(hour)}</p>
            <h1>{t.heading} <span className="accent">{t.headingAccent}</span></h1>
            <p className="today">
              {hour === null ? '\u00a0' : new Date().toLocaleDateString(t.locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="summary" aria-label={t.progress}>
            <div className="ring" aria-hidden="true" ref={ringRef}>
              <svg viewBox="0 0 84 84">
                <circle className="track" cx="42" cy="42" r="36" />
                <circle className="bar" cx="42" cy="42" r="36" strokeDasharray={RING_LEN} style={{ strokeDashoffset: RING_LEN * (1 - stats.pct / 100) }} />
              </svg>
              <span className="pct"><span><AnimatedNumber value={stats.pct} /><small>%</small></span></span>
            </div>
            <dl className="sum-list">
              <div><dt>{t.completed}</dt><dd><AnimatedNumber value={stats.done} /></dd></div>
              <div><dt>{t.remaining}</dt><dd><AnimatedNumber value={stats.active} /></dd></div>
              <div><dt>{t.dueToday}</dt><dd><AnimatedNumber value={stats.today} /></dd></div>
              <div><dt>{t.overdue}</dt><dd><AnimatedNumber value={stats.over} /></dd></div>
            </dl>
          </div>
        </section>

        {/* create */}
        <form className="form" onSubmit={submitForm} noValidate autoComplete="off">
          <label className={`field${invalid ? ' invalid' : ''}`}>
            <span className="sr-only">{t.titleLabel}</span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            <input
              ref={titleRef}
              type="text"
              placeholder={t.titlePh}
              maxLength={200}
              value={title}
              onChange={e => { setTitle(e.target.value); setInvalid(false); }}
            />
          </label>
          <label className="field">
            <span className="sr-only">{t.urlLabel}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            <input type="url" placeholder={t.urlPh} inputMode="url" value={url} onChange={e => setUrl(e.target.value)} />
          </label>
          <label className="field">
            <span className="sr-only">{t.dueLabel}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4.5" width="18" height="16.5" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </label>
          <button type="submit" className="addButton" disabled={submitting}>{t.create} <kbd>↵</kbd></button>
        </form>

        {/* toolbar */}
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={t.filterLabel}>
            <span className="tab-ind" aria-hidden="true" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />
            {FILTERS.map(f => (
              <button
                key={f}
                ref={el => { tabRefs.current[f] = el; }}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
              >
                {t[f]} <span className="count">{f === 'all' ? stats.all : f === 'active' ? stats.active : stats.done}</span>
              </button>
            ))}
          </div>
          <div className="tools-right">
            <label className="search">
              <span className="sr-only">{t.searchLabel}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input ref={searchRef} type="search" placeholder={t.searchPh} value={query} onChange={e => setQuery(e.target.value)} />
              <kbd>/</kbd>
            </label>
            <button
              className="sort-btn"
              type="button"
              data-dir={dir}
              aria-label={t.sortLabel(dir === 'asc')}
              onClick={() => setDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 16l4 4 4-4M13 6h8M13 11h6M13 16h4" /></svg>
              {t.sortBtn}
            </button>
          </div>
        </div>

        {/* list */}
        <ul className="todoListBox" aria-live="polite">
          {!loaded
            ? [0, 1, 2].map(i => <li key={`skel-${i}`} className="skel" aria-hidden="true" />)
            : rows.map(({ t, leave }, i) => renderItem(t, leave, i))}
        </ul>
        {loaded && visible.length === 0 && (
          <div className="empty show">
            <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden="true">
              <rect x="18" y="14" width="84" height="70" rx="14" fill="var(--card)" stroke="var(--line)" strokeWidth="2" />
              <rect x="30" y="30" width="14" height="14" rx="4" fill="var(--blue)" />
              <path d="M33.5 37l2.5 2.5 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="50" y="33" width="38" height="8" rx="4" fill="var(--blue-soft)" />
              <rect x="30" y="54" width="14" height="14" rx="4" stroke="var(--text-3)" strokeWidth="2" strokeOpacity=".5" />
              <rect x="50" y="57" width="28" height="8" rx="4" fill="var(--bg-2)" />
              <circle cx="100" cy="18" r="10" fill="var(--blue-2)" opacity=".25" />
              <circle cx="16" cy="78" r="6" fill="var(--blue)" opacity=".18" />
            </svg>
            <h2>{emptyCopy.title}</h2>
            <p>{emptyCopy.text}</p>
          </div>
        )}

        <div className="foot">
          <div className="shortcuts">
            <span><kbd>N</kbd>{t.scNew}</span>
            <span><kbd>/</kbd>{t.scSearch}</span>
            <span><kbd>Esc</kbd>{t.scCancel}</span>
            <span>{t.scDbl}</span>
          </div>
          <button type="button" onClick={clearDone} disabled={stats.done === 0}>{t.clearCompleted}</button>
        </div>
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast${t.out ? ' out' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="ico">
              {t.kind === 'error' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              )}
            </span>
            <span>{t.msg}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action?.run(); closeToast(t.id); }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
      <canvas className="confetti" ref={confettiRef} aria-hidden="true" />
    </>
  );
}
