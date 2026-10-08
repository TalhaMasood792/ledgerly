// Formatting and date helpers. Dates are stored as ISO date strings (YYYY-MM-DD)
// and compared as calendar days in UTC so daylight-saving shifts never move a due date.

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR'];

// Fixed demo exchange rates, expressed as USD per 1 unit of currency.
// Every dashboard conversion reads from this single constant.
export const FX_RATES_TO_USD = Object.freeze({
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  PKR: 0.0036,
});
export const BASE_CURRENCY = 'USD';

export function toBase(cents, currency) {
  const rate = FX_RATES_TO_USD[currency] ?? 1;
  return Math.round(cents * rate);
}

const moneyFormatters = new Map();
function moneyFormatter(currency, compact = false) {
  const key = currency + (compact ? ':c' : '');
  if (!moneyFormatters.has(key)) {
    const opts = { style: 'currency', currency };
    if (currency === 'PKR') opts.currencyDisplay = 'code';
    if (compact) {
      opts.notation = 'compact';
      opts.maximumFractionDigits = 1;
    }
    moneyFormatters.set(key, new Intl.NumberFormat('en-US', opts));
  }
  return moneyFormatters.get(key);
}

/** Format integer cents in the given currency. */
export function formatMoney(cents, currency = BASE_CURRENCY) {
  return moneyFormatter(currency).format((cents || 0) / 100);
}
export function formatMoneyCompact(cents, currency = BASE_CURRENCY) {
  return moneyFormatter(currency, true).format((cents || 0) / 100);
}

/** Cents → plain decimal string for inputs and CSV ("1234.50"). */
export function centsToDecimal(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? '-' + s : s;
}

/**
 * Parse a user-typed amount ("1,250.5", "1250") into integer cents without
 * floating point. Returns null when the text is not a valid non-negative amount.
 */
export function parseAmount(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

// ---- dates ----
export function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function todayISO() {
  return localISO(new Date());
}
export function nowStamp() {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return `${localISO(d)}T${t}`;
}
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = parseISO(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(s, n) {
  return new Date(parseISO(s) + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
export function monthKey(s) {
  return s.slice(0, 7);
}
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(s) {
  if (!s) return '—';
  return dateFmt.format(parseISO(s));
}
export function formatMonth(key) {
  return monthFmt.format(parseISO(key + '-01'));
}
export function formatMonthYear(key) {
  return monthYearFmt.format(parseISO(key + '-01'));
}
export function formatDateTime(stamp) {
  // Stamps are local "YYYY-MM-DDTHH:MM:SS"
  const [d, t = '00:00:00'] = stamp.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  return dateTimeFmt.format(new Date(y, m - 1, day, hh, mm, ss || 0));
}
export function relativeDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return '1 day';
  return `${n} days`;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
