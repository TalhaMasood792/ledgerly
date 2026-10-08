// Data layer: owns state, persistence, permission checks and the audit log.
// Every mutation goes through `mutate()`, which (1) checks the signed-in user's
// permission, (2) validates, (3) applies the change, (4) appends an audit entry,
// and (5) persists and notifies subscribers. The UI never writes state directly.
import { buildSeed } from './seed.js';
import { USERS, assertCan, PermissionError } from './permissions.js';
import {
  computeTotals, deriveStatus, paidCents, validateInvoice, dueDateFor, termsLabel,
  STATUS_LABELS, PAYMENT_METHODS, TERMS,
} from './invoice-math.js';
import { FX_RATES_TO_USD as FX, todayISO, nowStamp, isISODate, toBase, CURRENCIES, formatMoney, daysBetween, addDays, monthKey, addMonths } from './format.js';

const DATA_KEY = 'ledgerly:data:v1';
const USER_KEY = 'ledgerly:user';

export class ValidationError extends Error {
  constructor(errors, message = 'Some fields need attention.') {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}
export { PermissionError };

// ---------- safe storage ----------
const memory = new Map();
let storageOk = true;
function readStorage(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v ?? memory.get(key) ?? null;
  } catch {
    storageOk = false;
    return memory.get(key) ?? null;
  }
}
function writeStorage(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    storageOk = false;
  }
}
function removeStorage(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    storageOk = false;
  }
}
export function isPersistent() {
  return storageOk;
}

// ---------- state ----------
let state = null;
let currentUserId = USERS[0].id;
const listeners = new Set();
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function isValidState(s) {
  return s && s.version === 1 && Array.isArray(s.customers) && Array.isArray(s.invoices) && Array.isArray(s.audit);
}

export function init() {
  const raw = readStorage(DATA_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) state = parsed;
    } catch {
      /* corrupted data: reseed below */
    }
  }
  if (!state) {
    state = buildSeed(todayISO());
    persist();
  }
  const uid = readStorage(USER_KEY);
  if (uid && USERS.some((u) => u.id === uid)) currentUserId = uid;
}

function persist() {
  writeStorage(DATA_KEY, JSON.stringify(state));
}
function emit(evt) {
  for (const fn of listeners) {
    try {
      fn(evt);
    } catch (e) {
      console.error(e);
    }
  }
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetDemoData() {
  removeStorage(DATA_KEY);
  state = buildSeed(todayISO());
  persist();
  emit({ type: 'reset' });
}

// ---------- users ----------
export function getUsers() {
  return USERS;
}
export function getCurrentUser() {
  return USERS.find((u) => u.id === currentUserId) ?? USERS[0];
}
export function setCurrentUser(id) {
  if (!USERS.some((u) => u.id === id)) throw new Error('Unknown user');
  currentUserId = id;
  writeStorage(USER_KEY, id);
  emit({ type: 'user' });
}

// ---------- audit ----------
function audit(action, entityType, entityId, entityLabel, changes = [], note = '') {
  const u = getCurrentUser();
  state.auditSeq = (state.auditSeq || state.audit.length) + 1;
  const entry = {
    id: `a_${String(state.auditSeq).padStart(5, '0')}`,
    at: nowStamp(),
    userId: u.id, who: u.name, role: u.role,
    action, entityType, entityId, entityLabel, changes, note,
  };
  state.audit.push(entry);
  return entry;
}

/** Run a permission-checked mutation atomically: on any error, state is rolled back. */
function mutate(permission, fn) {
  assertCan(getCurrentUser(), permission);
  const snapshot = clone(state);
  try {
    const result = fn();
    persist();
    emit({ type: 'change', permission });
    return result;
  } catch (e) {
    state = snapshot;
    throw e;
  }
}

// ---------- reads ----------
export function today() {
  return todayISO();
}
export function getCustomers() {
  return state.customers;
}
export function getCustomer(id) {
  return state.customers.find((c) => c.id === id) ?? null;
}
export function getAudit() {
  return state.audit;
}
export function getAuditFor(entityType, entityId) {
  return state.audit.filter((a) => a.entityType === entityType && a.entityId === entityId);
}

/** Invoice enriched with computed totals, balance and derived status. */
export function viewInvoice(inv, t = todayISO()) {
  const totals = computeTotals(inv.lines);
  const paid = paidCents(inv);
  const status = deriveStatus(inv, t, totals);
  const balance = status === 'void' || status === 'draft' ? 0 : totals.total - paid;
  const customer = getCustomer(inv.customerId);
  return {
    ...inv, totals, paid, balance, status,
    customerName: customer?.name ?? 'Unknown customer',
    daysOverdue: status === 'overdue' ? daysBetween(inv.dueDate, t) : 0,
  };
}
export function getInvoices() {
  const t = todayISO();
  return state.invoices.map((i) => viewInvoice(i, t));
}
export function getInvoice(id) {
  const inv = state.invoices.find((i) => i.id === id);
  return inv ? viewInvoice(inv) : null;
}
function rawInvoice(id) {
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) throw new NotFoundError(`Invoice ${id} doesn’t exist.`);
  return inv;
}

export function customerBalances(customerId) {
  const c = getCustomer(customerId);
  const cur = c?.currency ?? 'USD';
  const invs = getInvoices().filter((i) => i.customerId === customerId);
  const conv = (cents, from) => (from === cur ? cents : Math.round(toBase(cents, from) / (FX[cur] ?? 1)));
  let open = 0, overdue = 0, paidTotal = 0, overdueCount = 0, openCount = 0;
  for (const i of invs) {
    paidTotal += conv(i.paid, i.currency);
    if (i.balance > 0) {
      open += conv(i.balance, i.currency);
      openCount++;
      if (i.status === 'overdue') {
        overdue += conv(i.balance, i.currency);
        overdueCount++;
      }
    }
  }
  return { currency: cur, open, overdue, paid: paidTotal, invoiceCount: invs.length, overdueCount, openCount };
}

// ---------- dashboard metrics (base currency USD) ----------
export function dashboardMetrics() {
  const t = todayISO();
  const invs = getInvoices();
  const live = invs.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const open = live.filter((i) => i.balance > 0);
  const outstanding = open.reduce((s, i) => s + toBase(i.balance, i.currency), 0);
  const overdueList = open.filter((i) => i.status === 'overdue');
  const overdue = overdueList.reduce((s, i) => s + toBase(i.balance, i.currency), 0);

  const thisMonth = monthKey(t);
  const lastMonth = addMonths(thisMonth, -1);
  let collectedThisMonth = 0;
  let collectedSamePointLastMonth = 0;
  const dayOfMonth = Number(t.slice(8, 10));
  for (const i of live) {
    for (const p of i.payments) {
      if (monthKey(p.date) === thisMonth) collectedThisMonth += toBase(p.amount, i.currency);
      if (monthKey(p.date) === lastMonth && Number(p.date.slice(8, 10)) <= dayOfMonth)
        collectedSamePointLastMonth += toBase(p.amount, i.currency);
    }
  }

  // DSO = AR ÷ credit sales in the period × days in the period (90-day window).
  const DSO_DAYS = 90;
  const windowStart = addDays(t, -DSO_DAYS);
  const creditSales = live.filter((i) => i.issueDate > windowStart && i.issueDate <= t).reduce((s, i) => s + toBase(i.totals.total, i.currency), 0);
  const dso = creditSales > 0 ? Math.round((outstanding / creditSales) * DSO_DAYS) : null;

  // 12 months of invoiced vs collected.
  const months = [];
  for (let k = 11; k >= 0; k--) months.push({ key: addMonths(thisMonth, -k), invoiced: 0, collected: 0 });
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const i of live) {
    const mi = idx[monthKey(i.issueDate)];
    if (mi != null) months[mi].invoiced += toBase(i.totals.total, i.currency);
    for (const p of i.payments) {
      const pi = idx[monthKey(p.date)];
      if (pi != null) months[pi].collected += toBase(p.amount, i.currency);
    }
  }

  // AR aging by days past due.
  const buckets = [
    { id: 'current', label: 'Current', test: (d) => d <= 0 },
    { id: '1-30', label: '1–30 days', test: (d) => d >= 1 && d <= 30 },
    { id: '31-60', label: '31–60 days', test: (d) => d >= 31 && d <= 60 },
    { id: '61-90', label: '61–90 days', test: (d) => d >= 61 && d <= 90 },
    { id: '90+', label: '90+ days', test: (d) => d > 90 },
  ].map((b) => ({ ...b, amount: 0, count: 0 }));
  for (const i of open) {
    const d = daysBetween(i.dueDate, t);
    const b = buckets.find((x) => x.test(d));
    b.amount += toBase(i.balance, i.currency);
    b.count++;
  }

  const attention = [...overdueList].sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance).slice(0, 6);
  return {
    today: t, outstanding, openCount: open.length, overdue, overdueCount: overdueList.length,
    collectedThisMonth, collectedSamePointLastMonth, dso, dsoDays: DSO_DAYS, creditSales, months, buckets, attention,
    draftCount: invs.filter((i) => i.status === 'draft').length,
  };
}

// ---------- invoice mutations ----------
function nextNumber(issueDate) {
  const year = (issueDate || todayISO()).slice(0, 4);
  state.sequences[year] = (state.sequences[year] || 0) + 1;
  let n = `INV-${year}-${String(state.sequences[year]).padStart(4, '0')}`;
  while (state.invoices.some((i) => i.id === n)) {
    state.sequences[year]++;
    n = `INV-${year}-${String(state.sequences[year]).padStart(4, '0')}`;
  }
  return n;
}

function normaliseInvoiceInput(input) {
  return {
    customerId: input.customerId || '',
    currency: input.currency,
    issueDate: input.issueDate,
    terms: TERMS.some((t) => t.id === input.terms) ? input.terms : 'net30',
    dueDate: input.dueDate || (isISODate(input.issueDate) ? dueDateFor(input.issueDate, input.terms) : ''),
    reference: String(input.reference || '').trim().slice(0, 80),
    notes: String(input.notes || '').trim(),
    lines: (input.lines || []).map((l, i) => ({
      key: l.key ?? i,
      description: String(l.description || '').trim(),
      qty: Number(l.qty),
      unitPrice: l.unitPrice,
      taxRate: Number(l.taxRate),
      discount: Number(l.discount),
    })),
  };
}

function checkInvoice(input) {
  const errors = validateInvoice(input, { customerExists: (id) => !!getCustomer(id) });
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

const moneyChange = (field, from, to, currency) => ({ field, from: from == null ? '' : { cents: from, currency }, to: to == null ? '' : { cents: to, currency } });

export function createInvoice(rawInput, { send = false } = {}) {
  return mutate('invoice.create', () => {
    if (send) assertCan(getCurrentUser(), 'invoice.send');
    const input = normaliseInvoiceInput(rawInput);
    checkInvoice(input);
    const number = nextNumber(input.issueDate);
    const now = nowStamp();
    const inv = {
      id: number, number,
      customerId: input.customerId, currency: input.currency,
      issueDate: input.issueDate, terms: input.terms, dueDate: input.dueDate,
      status: 'draft',
      lines: input.lines.map((l, i) => ({ id: `${number}-L${i + 1}`, description: l.description, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate, discount: l.discount })),
      payments: [], notes: input.notes, reference: input.reference,
      createdAt: now, updatedAt: now, sentAt: null, voidedAt: null, voidReason: '',
    };
    state.invoices.push(inv);
    const total = computeTotals(inv.lines).total;
    audit('invoice.created', 'invoice', number, number, [moneyChange('Total', null, total, inv.currency)], `Draft for ${getCustomer(inv.customerId).name}`);
    if (send) doSend(inv);
    return number;
  });
}

function diffInvoice(before, after) {
  const changes = [];
  const cust = (id) => getCustomer(id)?.name ?? id;
  if (before.customerId !== after.customerId) changes.push({ field: 'Customer', from: cust(before.customerId), to: cust(after.customerId) });
  if (before.currency !== after.currency) changes.push({ field: 'Currency', from: before.currency, to: after.currency });
  if (before.issueDate !== after.issueDate) changes.push({ field: 'Issue date', from: before.issueDate, to: after.issueDate });
  if (before.terms !== after.terms) changes.push({ field: 'Payment terms', from: termsLabel(before.terms), to: termsLabel(after.terms) });
  if (before.dueDate !== after.dueDate) changes.push({ field: 'Due date', from: before.dueDate, to: after.dueDate });
  if (before.lines.length !== after.lines.length) changes.push({ field: 'Line items', from: String(before.lines.length), to: String(after.lines.length) });
  const bt = computeTotals(before.lines).total, at = computeTotals(after.lines).total;
  if (bt !== at || before.currency !== after.currency) {
    changes.push({ field: 'Total', from: { cents: bt, currency: before.currency }, to: { cents: at, currency: after.currency } });
  }
  if (before.reference !== after.reference) changes.push({ field: 'Reference', from: before.reference || '—', to: after.reference || '—' });
  if (before.notes !== after.notes) changes.push({ field: 'Notes', from: 'previous text', to: 'updated' });
  return changes;
}

export function updateDraft(id, rawInput, { send = false } = {}) {
  return mutate('invoice.edit', () => {
    if (send) assertCan(getCurrentUser(), 'invoice.send');
    const inv = rawInvoice(id);
    if (inv.status !== 'draft') throw new Error(`${id} has been sent, so it can’t be edited. Duplicate it to make a new draft.`);
    const input = normaliseInvoiceInput(rawInput);
    checkInvoice(input);
    const before = clone(inv);
    Object.assign(inv, {
      customerId: input.customerId, currency: input.currency, issueDate: input.issueDate,
      terms: input.terms, dueDate: input.dueDate, notes: input.notes, reference: input.reference,
      lines: input.lines.map((l, i) => ({ id: `${id}-L${i + 1}`, description: l.description, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate, discount: l.discount })),
      updatedAt: nowStamp(),
    });
    const changes = diffInvoice(before, inv);
    if (changes.length) audit('invoice.updated', 'invoice', id, id, changes);
    if (send) doSend(inv);
    return id;
  });
}

function doSend(inv) {
  if (inv.status !== 'draft') throw new Error(`${inv.number} has already been sent.`);
  inv.status = 'sent';
  inv.sentAt = nowStamp();
  inv.updatedAt = inv.sentAt;
  const c = getCustomer(inv.customerId);
  audit('invoice.sent', 'invoice', inv.id, inv.number, [{ field: 'Status', from: 'Draft', to: 'Sent' }], c ? `Emailed to ${c.email}.` : '');
}

export function sendInvoice(id) {
  return mutate('invoice.send', () => doSend(rawInvoice(id)));
}

/** Mark many drafts as sent. Non-drafts are skipped. Returns { sent: [ids], skipped: [ids] }. */
export function sendInvoices(ids) {
  return mutate('invoice.send', () => {
    const sent = [], skipped = [];
    for (const id of ids) {
      const inv = rawInvoice(id);
      if (inv.status === 'draft' && inv.lines.length && getCustomer(inv.customerId)) {
        doSend(inv);
        sent.push(id);
      } else skipped.push(id);
    }
    return { sent, skipped };
  });
}

/** Undo "Mark as sent": return invoices to draft if nothing else happened to them. */
export function undoSend(ids) {
  return mutate('invoice.send', () => {
    const reverted = [];
    for (const id of ids) {
      const inv = rawInvoice(id);
      if (inv.status !== 'sent' || inv.payments.length) continue;
      reverted.push(id);
      inv.status = 'draft';
      inv.sentAt = null;
      inv.updatedAt = nowStamp();
      audit('invoice.send_undone', 'invoice', id, id, [{ field: 'Status', from: 'Sent', to: 'Draft' }], 'Undo of mark as sent.');
    }
    return reverted;
  });
}

export function deleteDraft(id) {
  return mutate('invoice.delete', () => {
    const inv = rawInvoice(id);
    if (inv.status !== 'draft') throw new Error(`${id} has been sent, so it can’t be deleted. Void it instead.`);
    state.invoices = state.invoices.filter((i) => i.id !== id);
    const total = computeTotals(inv.lines).total;
    audit('invoice.deleted', 'invoice', id, id, [moneyChange('Total', total, null, inv.currency)], 'Draft deleted.');
  });
}

export function voidInvoice(id, reason) {
  return mutate('invoice.void', () => {
    const inv = rawInvoice(id);
    const r = String(reason || '').trim();
    if (r.length < 5) throw new ValidationError({ reason: 'Enter a reason of at least 5 characters so the audit log explains the void.' });
    const v = viewInvoice(inv);
    if (v.status === 'void') throw new Error(`${id} is already void.`);
    if (v.status === 'draft') throw new Error(`${id} is a draft. Delete it instead of voiding.`);
    if (v.paid > 0) throw new Error(`${id} has payments recorded, so it can’t be voided. Refund the payments first.`);
    const from = STATUS_LABELS[v.status];
    inv.status = 'void';
    inv.voidReason = r;
    inv.voidedAt = nowStamp();
    inv.updatedAt = inv.voidedAt;
    audit('invoice.voided', 'invoice', id, id, [{ field: 'Status', from, to: 'Void' }], r);
  });
}

export function recordPayment(id, payment) {
  return mutate('payment.record', () => {
    const inv = rawInvoice(id);
    const v = viewInvoice(inv);
    const errors = {};
    if (!['sent', 'partial', 'overdue'].includes(v.status)) throw new Error(`${id} is ${STATUS_LABELS[v.status].toLowerCase()}, so payments can’t be recorded against it.`);
    const amount = payment.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = 'Enter an amount greater than 0, like 250.00.';
    else if (amount > v.balance) errors.amount = `That’s more than the balance due of ${formatMoney(v.balance, inv.currency)}. Enter ${formatMoney(v.balance, inv.currency)} or less.`;
    if (!isISODate(payment.date)) errors.date = 'Enter the date the payment was received.';
    else if (payment.date > todayISO()) errors.date = 'Payment date can’t be in the future.';
    else if (payment.date < inv.issueDate) errors.date = 'Payment date can’t be before the invoice issue date.';
    if (!PAYMENT_METHODS.includes(payment.method)) errors.method = 'Choose a payment method.';
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const p = {
      id: `${id}-P${inv.payments.length + 1}`,
      date: payment.date, amount, method: payment.method,
      reference: String(payment.reference || '').trim().slice(0, 80),
      recordedBy: getCurrentUser().id,
    };
    inv.payments.push(p);
    inv.updatedAt = nowStamp();
    const after = viewInvoice(inv);
    audit('payment.recorded', 'invoice', id, id,
      [moneyChange('Balance due', v.balance, after.balance, inv.currency), { field: 'Status', from: STATUS_LABELS[v.status], to: STATUS_LABELS[after.status] }].filter((c) => c.field !== 'Status' || c.from !== c.to),
      `${p.method} payment of ${formatMoney(amount, inv.currency)}${p.reference ? ` (${p.reference})` : ''}.`);
    return after;
  });
}

export function duplicateInvoice(id) {
  return mutate('invoice.create', () => {
    const src = rawInvoice(id);
    const issueDate = todayISO();
    const number = nextNumber(issueDate);
    const now = nowStamp();
    const inv = {
      ...clone(src),
      id: number, number, status: 'draft', issueDate, dueDate: dueDateFor(issueDate, src.terms),
      payments: [], createdAt: now, updatedAt: now, sentAt: null, voidedAt: null, voidReason: '',
    };
    inv.lines = inv.lines.map((l, i) => ({ ...l, id: `${number}-L${i + 1}` }));
    state.invoices.push(inv);
    audit('invoice.created', 'invoice', number, number, [moneyChange('Total', null, computeTotals(inv.lines).total, inv.currency)], `Duplicated from ${src.number}.`);
    return number;
  });
}

// ---------- customers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normaliseCustomer(input) {
  const s = (v, max = 120) => String(v ?? '').trim().slice(0, max);
  return {
    name: s(input.name), contactName: s(input.contactName), email: s(input.email).toLowerCase(), phone: s(input.phone, 40),
    address: { line1: s(input.line1 ?? input.address?.line1), line2: s(input.line2 ?? input.address?.line2), city: s(input.city ?? input.address?.city, 80), region: s(input.region ?? input.address?.region, 80), postal: s(input.postal ?? input.address?.postal, 20), country: s(input.country ?? input.address?.country, 80) },
    currency: input.currency, terms: input.terms, taxRate: Number(input.taxRate), taxId: s(input.taxId, 60), notes: s(input.notes, 1000),
  };
}
function validateCustomer(c, selfId = null) {
  const e = {};
  if (!c.name) e.name = 'Enter the company name.';
  else if (state.customers.some((x) => x.id !== selfId && x.name.toLowerCase() === c.name.toLowerCase())) e.name = `A customer called ${c.name} already exists. Use a different name or open the existing customer.`;
  if (!c.email) e.email = 'Enter a billing email so invoices have somewhere to go.';
  else if (!EMAIL_RE.test(c.email)) e.email = 'Enter an email address like accounts@company.com.';
  if (!c.address.country) e.country = 'Enter the country for the billing address.';
  if (!CURRENCIES.includes(c.currency)) e.currency = 'Choose a currency: USD, EUR, GBP or PKR.';
  if (!TERMS.some((t) => t.id === c.terms)) e.terms = 'Choose default payment terms.';
  if (!Number.isFinite(c.taxRate) || c.taxRate < 0 || c.taxRate > 100) e.taxRate = 'Default tax rate must be between 0 and 100.';
  if (Object.keys(e).length) throw new ValidationError(e);
}
function slug(name) {
  const base = 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'c_customer';
  let id = base, n = 2;
  while (state.customers.some((c) => c.id === id)) id = `${base}${n++}`;
  return id;
}

export function createCustomer(input) {
  return mutate('customer.create', () => {
    const c = normaliseCustomer(input);
    validateCustomer(c);
    const cust = { id: slug(c.name), ...c, createdAt: nowStamp() };
    state.customers.push(cust);
    audit('customer.created', 'customer', cust.id, cust.name, [], `Added ${cust.name} (${cust.currency}, ${termsLabel(cust.terms)}).`);
    return cust.id;
  });
}

const CUSTOMER_FIELDS = [
  ['name', 'Name'], ['contactName', 'Contact name'], ['email', 'Contact email'], ['phone', 'Phone'],
  ['currency', 'Currency'], ['terms', 'Payment terms'], ['taxRate', 'Default tax rate'], ['taxId', 'Tax ID'], ['notes', 'Notes'],
];
export function updateCustomer(id, input) {
  return mutate('customer.edit', () => {
    const cust = state.customers.find((c) => c.id === id);
    if (!cust) throw new NotFoundError('That customer doesn’t exist.');
    const c = normaliseCustomer(input);
    validateCustomer(c, id);
    const changes = [];
    for (const [k, label] of CUSTOMER_FIELDS) {
      if (String(cust[k] ?? '') !== String(c[k] ?? '')) {
        const fmt = (v) => (k === 'terms' ? termsLabel(v) : k === 'taxRate' ? `${v}%` : v || '—');
        changes.push({ field: label, from: fmt(cust[k]), to: fmt(c[k]) });
      }
    }
    const addr = (a) => [a.line1, a.line2, a.city, a.region, a.postal, a.country].filter(Boolean).join(', ');
    if (addr(cust.address) !== addr(c.address)) changes.push({ field: 'Billing address', from: addr(cust.address) || '—', to: addr(c.address) || '—' });
    Object.assign(cust, c);
    if (changes.length) audit('customer.updated', 'customer', id, cust.name, changes);
    return id;
  });
}

export const ACTION_LABELS = {
  'invoice.created': 'Invoice created',
  'invoice.updated': 'Draft edited',
  'invoice.sent': 'Invoice sent',
  'invoice.send_undone': 'Send undone',
  'invoice.deleted': 'Draft deleted',
  'invoice.voided': 'Invoice voided',
  'payment.recorded': 'Payment recorded',
  'customer.created': 'Customer added',
  'customer.updated': 'Customer edited',
};
