// Invoice arithmetic and validation. All money is integer cents.
// Line math uses BigInt so large quantities × prices never lose precision.
import { addDays, daysBetween, isISODate, CURRENCIES } from './format.js';

export const TERMS = [
  { id: 'due_on_receipt', label: 'Due on receipt', days: 0 },
  { id: 'net15', label: 'Net 15', days: 15 },
  { id: 'net30', label: 'Net 30', days: 30 },
  { id: 'net60', label: 'Net 60', days: 60 },
];
export function termsLabel(id) {
  return TERMS.find((t) => t.id === id)?.label ?? 'Custom';
}
export function dueDateFor(issueDate, termsId) {
  const t = TERMS.find((x) => x.id === termsId);
  return addDays(issueDate, t ? t.days : 30);
}

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  overdue: 'Overdue',
  partial: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};
export const STATUS_ORDER = ['draft', 'sent', 'overdue', 'partial', 'paid', 'void'];

/** Integer division rounded half-up (away from zero), BigInt in and out. */
function divHalfUp(num, den) {
  if (num < 0n) return -divHalfUp(-num, den);
  return (num * 2n + den) / (den * 2n);
}

/**
 * Compute one line. qty may have up to 3 decimals, taxRate up to 3, discount up to 2.
 * gross = qty × unit; discount = gross × d%; net = gross − discount; tax = net × t%.
 * Each step rounds half-up to whole cents, so tax is rounded per line.
 */
export function computeLine(line) {
  const qtyMilli = BigInt(Math.round((Number(line.qty) || 0) * 1000));
  const unit = BigInt(Math.round(Number(line.unitPrice) || 0));
  const discBp = BigInt(Math.round((Number(line.discount) || 0) * 100)); // percent × 100
  const taxMilli = BigInt(Math.round((Number(line.taxRate) || 0) * 1000)); // percent × 1000
  const gross = divHalfUp(qtyMilli * unit, 1000n);
  const discount = divHalfUp(gross * discBp, 10000n);
  const net = gross - discount;
  const tax = divHalfUp(net * taxMilli, 100000n);
  return {
    gross: Number(gross),
    discount: Number(discount),
    net: Number(net),
    tax: Number(tax),
    total: Number(net + tax),
  };
}

export function computeTotals(lines) {
  const t = { subtotal: 0, discount: 0, tax: 0, total: 0 };
  for (const l of lines) {
    const c = computeLine(l);
    t.subtotal += c.gross;
    t.discount += c.discount;
    t.tax += c.tax;
    t.total += c.total;
  }
  return t;
}

export function paidCents(inv) {
  return (inv.payments || []).reduce((s, p) => s + p.amount, 0);
}

/** Display status: overdue is derived, never stored. */
export function deriveStatus(inv, today, totals = computeTotals(inv.lines)) {
  if (inv.status === 'void') return 'void';
  if (inv.status === 'draft') return 'draft';
  const balance = totals.total - paidCents(inv);
  if (balance <= 0) return 'paid';
  if (inv.dueDate < today) return 'overdue';
  return paidCents(inv) > 0 ? 'partial' : 'sent';
}

export function daysOverdue(inv, today) {
  return Math.max(0, daysBetween(inv.dueDate, today));
}

function decimals(n) {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Validate a normalised invoice input. Lines carry numbers (NaN when unparseable).
 * Returns an ordered object of { fieldKey: message }. Line keys use `line.<key>.<field>`.
 */
export function validateInvoice(input, { customerExists = () => true } = {}) {
  const errors = {};
  if (!input.customerId) errors.customerId = 'Choose a customer for this invoice.';
  else if (!customerExists(input.customerId)) errors.customerId = 'That customer no longer exists. Choose another customer.';
  if (!CURRENCIES.includes(input.currency)) errors.currency = 'Choose a currency: USD, EUR, GBP or PKR.';
  if (!isISODate(input.issueDate)) errors.issueDate = 'Enter an issue date.';
  if (!isISODate(input.dueDate)) errors.dueDate = 'Enter a due date.';
  else if (isISODate(input.issueDate) && input.dueDate < input.issueDate)
    errors.dueDate = 'Due date can’t be before the issue date.';
  if (!input.lines || input.lines.length === 0) errors.lines = 'Add at least one line item.';
  (input.lines || []).forEach((l, i) => {
    const k = `line.${l.key ?? i}`;
    const n = i + 1;
    if (!String(l.description || '').trim()) errors[`${k}.description`] = `Enter a description for line ${n}.`;
    if (!Number.isFinite(l.qty) || l.qty <= 0) errors[`${k}.qty`] = `Quantity on line ${n} must be greater than 0.`;
    else if (l.qty > 1000000 || decimals(l.qty) > 3) errors[`${k}.qty`] = `Quantity on line ${n} can have at most 3 decimal places and be up to 1,000,000.`;
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0)
      errors[`${k}.unitPrice`] = `Enter a unit price on line ${n}, like 1250.00.`;
    else if (l.unitPrice > 100000000000) errors[`${k}.unitPrice`] = `Unit price on line ${n} is too large.`;
    if (!Number.isFinite(l.taxRate) || l.taxRate < 0 || l.taxRate > 100)
      errors[`${k}.taxRate`] = `Tax rate on line ${n} must be between 0 and 100.`;
    if (!Number.isFinite(l.discount) || l.discount < 0 || l.discount > 100)
      errors[`${k}.discount`] = `Discount on line ${n} must be between 0 and 100.`;
  });
  if (String(input.notes || '').length > 2000) errors.notes = 'Notes can be up to 2,000 characters.';
  return errors;
}

export const PAYMENT_METHODS = ['Bank transfer', 'Card', 'Cheque', 'Cash'];
