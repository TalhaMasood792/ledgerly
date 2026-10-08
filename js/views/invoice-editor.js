import * as store from '../store.js';
import { esc, formatMoney, centsToDecimal, parseAmount, todayISO, isISODate, CURRENCIES } from '../format.js';
import { TERMS, computeLine, computeTotals, dueDateFor, validateInvoice } from '../invoice-math.js';
import { can, denyReason } from '../permissions.js';
import { setTitle, permButton, icon, toast, errorMessage, showErrors, clearErrors, errSlot } from '../ui.js';
import { openCustomerDialog } from './customer-form.js';
import * as notFound from './not-found.js';

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function blankLine(taxRate = 0) {
  return { key: newKey(), description: '', qty: '1', unitPrice: '', taxRate: String(taxRate), discount: '0' };
}

/** Turn form-state strings into the numeric shape the store validates. */
function toInput(f) {
  const num = (s) => (String(s).trim() === '' ? NaN : Number(String(s).trim()));
  return {
    customerId: f.customerId, currency: f.currency, issueDate: f.issueDate, terms: f.terms, dueDate: f.dueDate,
    reference: f.reference, notes: f.notes,
    lines: f.lines.map((l) => ({
      key: l.key, description: l.description, qty: num(l.qty),
      unitPrice: parseAmount(l.unitPrice) ?? NaN, taxRate: num(l.taxRate), discount: num(l.discount),
    })),
  };
}

export function render(root, params) {
  const user = store.getCurrentUser();
  const isEdit = params.mode === 'edit';
  let existing = null;
  if (isEdit) {
    existing = store.getInvoice(params.id);
    if (!existing) return notFound.render(root, { ...params, kind: 'invoice' });
  }
  const perm = isEdit ? 'invoice.edit' : 'invoice.create';
  setTitle(isEdit ? `Edit ${existing.number}` : 'New invoice');

  if (!can(user, perm) || (isEdit && existing.status !== 'draft')) {
    const msg = !can(user, perm) ? denyReason(user, perm) : `${existing.number} has already been sent, so it can’t be edited. Duplicate it to start a new draft.`;
    root.innerHTML = `<div class="nf">${icon('lock')}<h1>${isEdit ? 'This invoice can’t be edited' : 'You can’t create invoices'}</h1><p>${esc(msg)}</p>
      <div class="actions"><a class="btn" href="${isEdit ? `#/invoices/${encodeURIComponent(existing.id)}` : '#/invoices'}">${isEdit ? 'View invoice' : 'Back to invoices'}</a></div></div>`;
    root.querySelector('svg').style.cssText = 'width:36px;height:36px;color:var(--muted);margin-bottom:8px';
    return {};
  }

  // ---------- form state ----------
  const today = todayISO();
  const f = existing
    ? {
        customerId: existing.customerId, currency: existing.currency, issueDate: existing.issueDate, terms: existing.terms,
        dueDate: existing.dueDate, dueManual: existing.dueDate !== dueDateFor(existing.issueDate, existing.terms),
        reference: existing.reference || '', notes: existing.notes || '',
        lines: existing.lines.map((l) => ({ key: newKey(), description: l.description, qty: String(l.qty), unitPrice: centsToDecimal(l.unitPrice), taxRate: String(l.taxRate), discount: String(l.discount) })),
      }
    : {
        customerId: params.query.get('customer') || '', currency: 'USD', issueDate: today, terms: 'net30', dueDate: dueDateFor(today, 'net30'), dueManual: false,
        reference: '', notes: 'Thank you for your business.', lines: [blankLine()],
      };
  if (!existing && f.customerId) {
    const c = store.getCustomer(f.customerId);
    if (c) Object.assign(f, { currency: c.currency, terms: c.terms, dueDate: dueDateFor(today, c.terms) }), (f.lines = [blankLine(c.taxRate)]);
    else f.customerId = '';
  }
  const snapshot = () => JSON.stringify({ ...f, lines: f.lines.map(({ key, ...r }) => r) });
  let saved = snapshot();
  let leaving = false;
  const isDirty = () => !leaving && snapshot() !== saved;
  let triedSubmit = false;

  const customersSorted = () => store.getCustomers().slice().sort((a, b) => a.name.localeCompare(b.name));

  root.innerHTML = `
  <div class="page-head">
    <div>
      <nav class="crumb" aria-label="Breadcrumb"><a href="#/invoices">Invoices</a><span aria-hidden="true">/</span>${isEdit ? `<a class="mono" href="#/invoices/${encodeURIComponent(existing.id)}">${esc(existing.number)}</a><span aria-hidden="true">/</span><span aria-current="page">Edit</span>` : '<span aria-current="page">New</span>'}</nav>
      <h1>${isEdit ? `Edit draft <span class="mono" style="font-weight:500">${esc(existing.number)}</span>` : 'New invoice'}</h1>
      <p class="sub">${isEdit ? 'Changes are recorded in the audit log when you save.' : 'The invoice number is assigned when you save.'}</p>
    </div>
  </div>
  <form id="inv-form" novalidate>
    <div id="err-summary"></div>
    <div class="editor">
      <div class="stack-16">
        <section class="card" aria-labelledby="h-details">
          <div class="card-head"><h2 id="h-details">Details</h2></div>
          <div class="card-body form-grid">
            <div class="field span-2">
              <label for="e-customer">Customer</label>
              <div class="inline-row">
                <select id="e-customer" name="customerId" class="input" aria-describedby="err-customerId"></select>
                ${permButton('customer.create', { label: 'Add customer', cls: 'btn', action: 'add-customer', iconName: 'plus' })}
              </div>
              ${errSlot('customerId')}
            </div>
            <div class="field"><label for="e-currency">Currency</label>
              <select id="e-currency" name="currency" class="input" aria-describedby="err-currency">${CURRENCIES.map((c) => `<option ${c === f.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>${errSlot('currency')}</div>
            <div class="field"><label for="e-ref">PO or reference <span class="muted">(optional)</span></label>
              <input id="e-ref" name="reference" class="input" maxlength="80" value="${esc(f.reference)}" autocomplete="off"></div>
            <div class="field"><label for="e-issue">Issue date</label>
              <input id="e-issue" name="issueDate" type="date" class="input" value="${esc(f.issueDate)}" aria-describedby="err-issueDate">${errSlot('issueDate')}</div>
            <div class="field"><label for="e-terms">Payment terms</label>
              <select id="e-terms" name="terms" class="input">${TERMS.map((t) => `<option value="${t.id}" ${t.id === f.terms ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
            <div class="field"><label for="e-due">Due date</label>
              <input id="e-due" name="dueDate" type="date" class="input" value="${esc(f.dueDate)}" aria-describedby="err-dueDate due-hint">${errSlot('dueDate')}
              <span class="hint" id="due-hint"></span></div>
          </div>
        </section>

        <section class="card" aria-labelledby="h-lines">
          <div class="card-head"><h2 id="h-lines">Line items</h2><span class="meta" id="line-count"></span></div>
          <div class="tbl-scroll" style="overflow:visible">
            <table class="lines-table">
              <thead><tr><th scope="col" class="c-desc">Description</th><th scope="col" class="num c-qty">Qty</th><th scope="col" class="num c-price">Unit price</th><th scope="col" class="num c-pct">Tax %</th><th scope="col" class="num c-pct">Disc. %</th><th scope="col" class="num c-amt">Amount</th><th scope="col" class="c-ops"><span class="sr-only">Row actions</span></th></tr></thead>
              <tbody id="lines"></tbody>
            </table>
          </div>
          ${errSlot('lines')}
          <div class="lines-foot"><button type="button" class="btn" data-action="add-line">${icon('plus')}<span>Add line</span></button><span class="small muted">Tax is calculated per line after discount and rounded to the cent.</span></div>
        </section>

        <section class="card" aria-labelledby="h-notes">
          <div class="card-head"><h2 id="h-notes">Notes</h2></div>
          <div class="card-body"><div class="field"><label for="e-notes">Notes shown on the invoice</label>
            <textarea id="e-notes" name="notes" class="input" rows="3" maxlength="2000" aria-describedby="err-notes">${esc(f.notes)}</textarea>${errSlot('notes')}</div></div>
        </section>
      </div>

      <aside class="editor-side">
        <section class="card totals-card" aria-labelledby="h-totals">
          <div class="card-head"><h2 id="h-totals">Totals</h2><span class="meta" id="tot-cur"></span></div>
          <dl aria-live="polite">
            <div><dt>Subtotal</dt><dd id="t-sub"></dd></div>
            <div><dt>Discount</dt><dd id="t-disc"></dd></div>
            <div><dt>Tax</dt><dd id="t-tax"></dd></div>
            <div class="grand"><dt>Total</dt><dd id="t-total"></dd></div>
          </dl>
          <div class="editor-actions">
            ${permButton('invoice.send', { label: 'Save and send', cls: 'btn btn-primary', action: 'save-send', iconName: 'send' })}
            <button type="button" class="btn" data-action="save-draft">Save as draft</button>
            <a class="btn btn-ghost" href="${isEdit ? `#/invoices/${encodeURIComponent(existing.id)}` : '#/invoices'}">Cancel</a>
          </div>
        </section>
      </aside>
    </div>
  </form>`;

  const $ = (s) => root.querySelector(s);
  const form = $('#inv-form');

  function fillCustomers() {
    $('#e-customer').innerHTML = `<option value="">Choose a customer</option>` + customersSorted().map((c) => `<option value="${esc(c.id)}" ${c.id === f.customerId ? 'selected' : ''}>${esc(c.name)} · ${c.currency}</option>`).join('');
  }

  function lineRow(l, i, n) {
    const k = l.key;
    const c = computeLine({ qty: Number(l.qty) || 0, unitPrice: parseAmount(l.unitPrice) ?? 0, taxRate: Number(l.taxRate) || 0, discount: Number(l.discount) || 0 });
    const inp = (field, value, cls, extra = '') => `<input id="l-${k}-${field}" name="line.${k}.${field}" class="input ${cls}" value="${esc(value)}" autocomplete="off" aria-describedby="err-line-${k}-${field}" ${extra}>`;
    return `<tr data-key="${k}">
      <td class="c-desc"><label class="sr-only" for="l-${k}-description">Line ${i + 1} description</label><span class="m-label" aria-hidden="true">Line ${i + 1}</span>
        ${inp('description', l.description, '', 'placeholder="What was delivered" maxlength="200"')}${errSlot(`line.${k}.description`)}</td>
      <td class="c-qty"><label class="sr-only" for="l-${k}-qty">Line ${i + 1} quantity</label><span class="m-label" aria-hidden="true">Qty</span>${inp('qty', l.qty, 'num-input', 'inputmode="decimal"')}${errSlot(`line.${k}.qty`)}</td>
      <td class="c-price"><label class="sr-only" for="l-${k}-unitPrice">Line ${i + 1} unit price</label><span class="m-label" aria-hidden="true">Unit price</span>${inp('unitPrice', l.unitPrice, 'num-input', 'inputmode="decimal" placeholder="0.00"')}${errSlot(`line.${k}.unitPrice`)}</td>
      <td class="c-pct"><label class="sr-only" for="l-${k}-taxRate">Line ${i + 1} tax rate percent</label><span class="m-label" aria-hidden="true">Tax %</span>${inp('taxRate', l.taxRate, 'num-input', 'inputmode="decimal"')}${errSlot(`line.${k}.taxRate`)}</td>
      <td class="c-pct"><label class="sr-only" for="l-${k}-discount">Line ${i + 1} discount percent</label><span class="m-label" aria-hidden="true">Disc. %</span>${inp('discount', l.discount, 'num-input', 'inputmode="decimal"')}${errSlot(`line.${k}.discount`)}</td>
      <td class="c-amt num mono" data-amt="${k}">${esc(formatMoney(c.total, f.currency))}</td>
      <td class="c-ops">
        <button type="button" class="btn btn-ghost btn-icon" data-move="up" aria-label="Move line ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-move="down" aria-label="Move line ${i + 1} down" ${i === n - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-remove aria-label="Remove line ${i + 1}" ${n === 1 ? 'disabled' : ''}>${icon('trash')}</button>
      </td></tr>`;
  }

  function drawLines() {
    $('#lines').innerHTML = f.lines.map((l, i) => lineRow(l, i, f.lines.length)).join('');
    $('#line-count').textContent = `${f.lines.length} ${f.lines.length === 1 ? 'line' : 'lines'}`;
    drawTotals();
  }

  function drawTotals() {
    const lines = f.lines.map((l) => ({ qty: Number(l.qty) || 0, unitPrice: parseAmount(l.unitPrice) ?? 0, taxRate: Number(l.taxRate) || 0, discount: Number(l.discount) || 0 }));
    const t = computeTotals(lines);
    $('#t-sub').textContent = formatMoney(t.subtotal, f.currency);
    $('#t-disc').textContent = (t.discount ? '−' : '') + formatMoney(t.discount, f.currency);
    $('#t-tax').textContent = formatMoney(t.tax, f.currency);
    $('#t-total').textContent = formatMoney(t.total, f.currency);
    $('#tot-cur').textContent = f.currency;
    f.lines.forEach((l, i) => {
      const cell = root.querySelector(`[data-amt="${l.key}"]`);
      if (cell) cell.textContent = formatMoney(computeLine(lines[i]).total, f.currency);
    });
  }

  function drawDueHint() {
    const t = TERMS.find((x) => x.id === f.terms);
    $('#due-hint').textContent = f.dueManual ? 'Set manually. Change the terms to recalculate.' : `${t.label} from the issue date.`;
  }

  function revalidate() {
    if (!triedSubmit) return;
    const errors = validateInvoice(toInput(f), { customerExists: (id) => !!store.getCustomer(id) });
    clearErrors(form);
    for (const [k, msg] of Object.entries(errors)) {
      const slot = root.querySelector(`.err[data-for="${CSS.escape(k)}"]`);
      if (slot) slot.textContent = msg;
      root.querySelector(`[name="${CSS.escape(k)}"]`)?.setAttribute('aria-invalid', 'true');
    }
    if (!Object.keys(errors).length) $('#err-summary').innerHTML = '';
  }

  // ---------- events ----------
  form.addEventListener('input', (e) => {
    const t = e.target;
    const m = t.name?.match(/^line\.(k\d+)\.(\w+)$/);
    if (m) {
      const l = f.lines.find((x) => x.key === m[1]);
      if (l) l[m[2]] = t.value;
      drawTotals();
    } else if (t.name === 'reference' || t.name === 'notes') f[t.name] = t.value;
    revalidate();
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'customerId') {
      f.customerId = t.value;
      const c = store.getCustomer(t.value);
      if (c) {
        f.currency = c.currency;
        $('#e-currency').value = c.currency;
        if (!f.dueManual) {
          f.terms = c.terms;
          $('#e-terms').value = c.terms;
        }
        // Apply the customer's default tax rate to lines that haven't been filled in yet.
        f.lines.forEach((l) => {
          if (!l.description && !l.unitPrice) l.taxRate = String(c.taxRate);
        });
        drawLines();
      }
    }
    if (t.name === 'currency') {
      f.currency = t.value;
      drawTotals();
    }
    if (t.name === 'issueDate') f.issueDate = t.value;
    if (t.name === 'terms') {
      f.terms = t.value;
      f.dueManual = false;
    }
    if ((t.name === 'issueDate' || t.name === 'terms' || t.name === 'customerId') && !f.dueManual && isISODate(f.issueDate)) {
      f.dueDate = dueDateFor(f.issueDate, f.terms);
      $('#e-due').value = f.dueDate;
    }
    if (t.name === 'dueDate') {
      f.dueDate = t.value;
      f.dueManual = t.value !== (isISODate(f.issueDate) ? dueDateFor(f.issueDate, f.terms) : '');
    }
    drawDueHint();
    revalidate();
  });

  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[aria-disabled="true"]')) return;
    const row = t.closest('tr[data-key]');
    if (row && t.closest('[data-move]')) {
      const i = f.lines.findIndex((l) => l.key === row.dataset.key);
      const dir = t.closest('[data-move]').dataset.move === 'up' ? -1 : 1;
      const j = i + dir;
      if (j < 0 || j >= f.lines.length) return;
      [f.lines[i], f.lines[j]] = [f.lines[j], f.lines[i]];
      drawLines();
      revalidate();
      const btn = root.querySelector(`tr[data-key="${row.dataset.key}"] [data-move="${dir < 0 ? 'up' : 'down'}"]`);
      (btn && !btn.disabled ? btn : root.querySelector(`tr[data-key="${row.dataset.key}"] input`))?.focus();
      return;
    }
    if (row && t.closest('[data-remove]')) {
      if (f.lines.length === 1) return;
      const i = f.lines.findIndex((l) => l.key === row.dataset.key);
      f.lines.splice(i, 1);
      drawLines();
      revalidate();
      const next = f.lines[Math.min(i, f.lines.length - 1)];
      root.querySelector(`#l-${next.key}-description`)?.focus();
      return;
    }
    const act = t.closest('[data-action]')?.dataset.action;
    if (act === 'add-line') {
      const c = store.getCustomer(f.customerId);
      const l = blankLine(c ? c.taxRate : f.lines.at(-1)?.taxRate ?? 0);
      f.lines.push(l);
      drawLines();
      revalidate();
      root.querySelector(`#l-${l.key}-description`)?.focus();
    }
    if (act === 'add-customer') {
      const id = await openCustomerDialog();
      if (id) {
        f.customerId = id;
        fillCustomers();
        $('#e-customer').value = id;
        $('#e-customer').dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (act === 'save-draft' || act === 'save-send') save(act === 'save-send');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(false);
  });

  function save(send) {
    triedSubmit = true;
    clearErrors(form);
    $('#err-summary').innerHTML = '';
    const input = toInput(f);
    try {
      const id = isEdit ? store.updateDraft(existing.id, input, { send }) : store.createInvoice(input, { send });
      saved = snapshot();
      leaving = true;
      toast(send ? `${id} saved and sent to ${store.getCustomer(f.customerId)?.email}.` : `${id} saved as a draft.`);
      location.hash = `#/invoices/${encodeURIComponent(id)}`;
    } catch (err) {
      if (err instanceof store.ValidationError) {
        const entries = Object.entries(err.errors);
        $('#err-summary').innerHTML = `<div class="error-summary" role="alert"><h2>${entries.length === 1 ? 'There’s 1 problem to fix' : `There are ${entries.length} problems to fix`}</h2><ul>${entries.slice(0, 6).map(([k, m]) => `<li>${esc(m)}</li>`).join('')}${entries.length > 6 ? `<li>…and ${entries.length - 6} more</li>` : ''}</ul></div>`;
        showErrors(form, err.errors);
        if (err.errors.lines) $('[data-action="add-line"]').focus();
      } else {
        toast(errorMessage(err), { error: true });
      }
    }
  }

  fillCustomers();
  drawLines();
  drawDueHint();

  return {
    canLeave: () => !isDirty(),
    forceLeave: () => (leaving = true),
    onStoreChange() {
      fillCustomers();
    },
  };
}
