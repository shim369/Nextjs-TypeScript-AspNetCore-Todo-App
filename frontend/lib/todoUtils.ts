import { ToDoItem } from '../types/todo';
import type { Lang } from './i18n';

/* ===== dates ===== */
const pad = (n: number) => String(n).padStart(2, '0');

export const toInputDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDue = (s?: string | null): Date | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const daysFromToday = (d: Date) => Math.round((d.getTime() - startOfToday().getTime()) / 86400000);

export const fmtDate = (d: Date, locale = 'en-US') =>
  d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });

/* ===== urls ===== */
export const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
};

export const safeUrl = (u?: string | null) => {
  if (!u) return '';
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : '';
  } catch (e) { return ''; }
};

/* ===== storage (使えない環境でも落ちないように) ===== */
export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ===== demo data (API に繋がらないときに使用) ===== */
const SEED_TITLES: Record<Lang, string[]> = {
  en: [
    'Fix CORS settings for the frontend',
    'Add validation to the ToDo API',
    'Write the README setup steps',
    'Read the Next.js data fetching docs',
    'Create the initial EF Core migration',
  ],
  ja: [
    'フロントエンド用のCORS設定を修正する',
    'ToDo APIに入力チェックを追加する',
    'READMEにセットアップ手順を書く',
    'Next.jsのデータ取得ドキュメントを読む',
    'EF Coreの初回マイグレーションを作成する',
  ],
};

export const seedTodos = (lang: Lang = 'en'): ToDoItem[] => {
  const d = (n: number) => {
    const x = startOfToday();
    x.setDate(x.getDate() + n);
    return toInputDate(x) + 'T00:00:00';
  };
  const [t1, t2, t3, t4, t5] = SEED_TITLES[lang];
  return [
    { id: 1, title: t1, url: 'https://learn.microsoft.com/aspnet/core/security/cors', dueDate: d(-1), isComplete: false },
    { id: 2, title: t2, url: 'https://learn.microsoft.com/aspnet/core/mvc/models/validation', dueDate: d(0), isComplete: false },
    { id: 3, title: t3, url: 'https://github.com/shim369/Nextjs-TypeScript-AspNetCore-Todo-App', dueDate: d(2), isComplete: false },
    { id: 4, title: t4, url: 'https://nextjs.org/docs', dueDate: d(5), isComplete: false },
    { id: 5, title: t5, url: 'https://learn.microsoft.com/ef/core/managing-schemas/migrations/', dueDate: d(-3), isComplete: true },
  ];
};
