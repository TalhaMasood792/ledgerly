// Add / edit customer dialog, shared by the customers views and the invoice editor.
import * as store from '../store.js';
import { esc, CURRENCIES } from '../format.js';
import { TERMS } from '../invoice-math.js';
import { openDialog, errSlot, toast } from '../ui.js';

function field(name, label, value = '', { type = 'text', span = '', hint = '', attrs = '' } = {}) {
  return `<div class="field ${span}"><label for="cf-${name}">${label}</label>
    <input id="cf-${name}" name="${name}" type="${type}" class="input" value="${esc(value)}" aria-describedby="err-${name}" ${attrs}>
    ${errSlot(name)}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
}

/** Opens the dialog; resolves with the customer id, or null when cancelled. */
export function openCustomerDialog(existing = null) {
  const c = existing || { currency: 'USD', terms: 'net30', taxRate: 0, address: {} };
  const a = c.address || {};
  return openDialog({
    title: existing ? `Edit ${existing.name}` : 'Add customer',
    submitLabel: existing ? 'Save customer' : 'Add customer',
    wide: true,
    body: `<div class="form-grid">
      ${field('name', 'Company name', c.name, { span: 'span-2', attrs: 'autocomplete="organization" autofocus' })}
      ${field('contactName', 'Contact name <span class="muted">(optional)</span>', c.contactName, { span: 'span-2', attrs: 'autocomplete="name"' })}
      ${field('email', 'Billing email', c.email, { type: 'email', span: 'span-2', attrs: 'autocomplete="email"' })}
      ${field('phone', 'Phone <span class="muted">(optional)</span>', c.phone, { type: 'tel', span: 'span-2', attrs: 'autocomplete="tel"' })}
      ${field('line1', 'Street address', a.line1, { span: 'span-4', attrs: 'autocomplete="address-line1"' })}
      ${field('city', 'City', a.city, { attrs: 'autocomplete="address-level2"' })}
      ${field('region', 'State or region', a.region, { attrs: 'autocomplete="address-level1"' })}
      ${field('postal', 'Postal code', a.postal, { attrs: 'autocomplete="postal-code"' })}
      ${field('country', 'Country', a.country, { attrs: 'autocomplete="country-name"' })}
      <div class="field"><label for="cf-currency">Currency</label><select id="cf-currency" name="currency" class="input">${CURRENCIES.map((x) => `<option ${x === c.currency ? 'selected' : ''}>${x}</option>`).join('')}</select>${errSlot('currency')}</div>
      <div class="field"><label for="cf-terms">Default terms</label><select id="cf-terms" name="terms" class="input">${TERMS.map((t) => `<option value="${t.id}" ${t.id === c.terms ? 'selected' : ''}>${t.label}</option>`).join('')}</select>${errSlot('terms')}</div>
      ${field('taxRate', 'Default tax rate (%)', c.taxRate ?? 0, { attrs: 'inputmode="decimal"' })}
      ${field('taxId', 'Tax ID <span class="muted">(optional)</span>', c.taxId)}
    </div>`,
    onSubmit: (form) => {
      const v = Object.fromEntries(new FormData(form).entries());
      v.taxRate = v.taxRate === '' ? NaN : Number(v.taxRate);
      if (existing) {
        store.updateCustomer(existing.id, { ...v, notes: existing.notes });
        toast(`Saved changes to ${v.name.trim()}.`);
        return existing.id;
      }
      const id = store.createCustomer(v);
      toast(`Added ${v.name.trim()}.`);
      return id;
    },
  });
}
