import * as store from '../store.js';
import { esc, formatMoney, formatDate, centsToDecimal, parseAmount, todayISO, plural } from '../format.js';
import { computeLine, termsLabel, PAYMENT_METHODS, STATUS_LABELS } from '../invoice-math.js';
import { can, USERS } from '../permissions.js';
import { setTitle, permButton, icon, badge, toast, errorMessage, openDialog, confirmDialog, errSlot, renderTimeline } from '../ui.js';
import * as notFound from './not-found.js';

export const COMPANY = {
  name: 'Northwind Studio Ltd',
  short: 'NS',
  lines: ['Suite 4, 21 Shahrah-e-Faisal', 'Karachi 75350, Pakistan', 'billing@northwind.studio · +92 21 3456 7890', 'NTN 8842217-3'],
  bank: {
    USD: ['Bank: Meezan Bank Ltd (USD account)', 'IBAN: PK36 MEZN 0001 2300 0458 9921', 'SWIFT: MEZNPKKA'],
    EUR: ['Bank: Meezan Bank Ltd (EUR account)', 'IBAN: PK12 MEZN 0001 2300 0458 9934', 'SWIFT: MEZNPKKA'],
    GBP: ['Bank: Meezan Bank Ltd (GBP account)', 'IBAN: PK88 MEZN 0001 2300 0458 9947', 'SWIFT: MEZNPKKA'],
    PKR: ['Bank: Meezan Bank Ltd', 'Account title: Northwind Studio Ltd', 'IBAN: PK51 MEZN 0001 2300 0458 9900'],
  },
};

function qtyFmt(q) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(q);
}

function documentHTML(inv, customer) {
  const a = customer?.address || {};
  const stamp = inv.status === 'paid' ? '<span class="doc-stamp paid">Paid</span>' : inv.status === 'void' ? '<span class="doc-stamp void">Void</span>' : '';
  const anyDiscount = inv.lines.some((l) => Number(l.discount) > 0);
  return `<article class="paper" aria-label="Invoice ${esc(inv.number)}">
    <header class="doc-head">
      <div class="doc-from">
        <div class="doc-logo" aria-hidden="true">${COMPANY.short}</div>
        <div><div class="doc-co">${esc(COMPANY.name)}</div><address class="doc-addr">${COMPANY.lines.map(esc).join('<br>')}</address></div>
      </div>
      <div class="doc-title"><h2>Invoice</h2><div class="mono">${esc(inv.number)}</div>${stamp}</div>
    </header>
    <div class="doc-meta">
      <div><div class="doc-label">Bill to</div>
        <div style="font-weight:600">${esc(customer?.name ?? 'Unknown customer')}</div>
        <address class="doc-addr">${[customer?.contactName ? 'Attn: ' + customer.contactName : '', a.line1, a.line2, [a.city, a.region, a.postal].filter(Boolean).join(', '), a.country, customer?.email, customer?.taxId].filter(Boolean).map(esc).join('<br>')}</address>
      </div>
      <dl>
        <dt>Issue date</dt><dd>${esc(formatDate(inv.issueDate))}</dd>
        <dt>Due date</dt><dd>${esc(formatDate(inv.dueDate))}</dd>
      </dl>
      <dl>
        <dt>Terms</dt><dd>${esc(termsLabel(inv.terms))}</dd>
        <dt>${inv.reference ? 'Reference' : 'Currency'}</dt><dd>${esc(inv.reference || inv.currency)}</dd>
      </dl>
    </div>
    <table class="doc-lines">
      <thead><tr><th scope="col">Description</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Unit price</th><th scope="col" class="num hide-xs">Tax</th><th scope="col" class="num">Amount</th></tr></thead>
      <tbody>${inv.lines.map((l) => {
        const c = computeLine(l);
        return `<tr><td>${esc(l.description)}${Number(l.discount) > 0 ? `<span class="disc">Less ${l.discount}% discount (−${esc(formatMoney(c.discount, inv.currency))})</span>` : ''}</td>
          <td class="num mono">${qtyFmt(l.qty)}</td><td class="num mono">${esc(formatMoney(l.unitPrice, inv.currency))}</td>
          <td class="num mono hide-xs">${l.taxRate}%</td><td class="num mono">${esc(formatMoney(c.net, inv.currency))}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <div class="doc-totals">
      <div><span class="muted">Subtotal</span><span class="mono">${esc(formatMoney(inv.totals.subtotal, inv.currency))}</span></div>
      ${anyDiscount ? `<div><span class="muted">Discount</span><span class="mono">−${esc(formatMoney(inv.totals.discount, inv.currency))}</span></div>` : ''}
      <div><span class="muted">Tax</span><span class="mono">${esc(formatMoney(inv.totals.tax, inv.currency))}</span></div>
      <div class="grand"><span>Total</span><span class="mono">${esc(formatMoney(inv.totals.total, inv.currency))}</span></div>
      ${inv.paid ? `<div><span class="muted">Paid</span><span class="mono">−${esc(formatMoney(inv.paid, inv.currency))}</span></div>` : ''}
      ${inv.status !== 'void' && inv.status !== 'draft' ? `<div class="due"><span>Balance due</span><span class="mono">${esc(formatMoney(inv.balance, inv.currency))}</span></div>` : ''}
    </div>
    <footer class="doc-foot">
      <div><div class="doc-label">Payment instructions</div>${COMPANY.bank[inv.currency].map((x) => `<p class="ink">${esc(x)}</p>`).join('')}<p>Please quote ${esc(inv.number)} as the payment reference.</p></div>
      <div><div class="doc-label">Notes</div><p class="ink" style="white-space:pre-line">${esc(inv.notes || '—')}</p>${inv.status === 'void' ? `<p style="margin-top:8px;color:var(--danger-text)">Voided: ${esc(inv.voidReason)}</p>` : ''}</div>
    </footer>
  </article>`;
}

export function render(root, params) {
  let inv = store.getInvoice(params.id);
  if (!inv) return notFound.render(root, { ...params, kind: 'invoice' });

  function draw() {
    inv = store.getInvoice(params.id);
    if (!inv) {
      location.hash = '#/invoices';
      return;
    }
    setTitle(inv.number);
    const customer = store.getCustomer(inv.customerId);
    const user = store.getCurrentUser();
    const isDraft = inv.status === 'draft';
    const canPay = ['sent', 'partial', 'overdue'].includes(inv.status);
    const actions = [];
    if (isDraft) {
      actions.push(permButton('invoice.edit', { label: 'Edit draft', cls: 'btn', action: 'edit', iconName: 'edit' }));
      actions.push(permButton('invoice.delete', { label: 'Delete draft', cls: 'btn btn-danger-ghost btn-ghost', action: 'delete', iconName: 'trash' }));
      actions.push(permButton('invoice.send', { label: 'Send invoice', cls: 'btn btn-primary', action: 'send', iconName: 'send' }));
    } else {
      if (canPay && !inv.paid) actions.push(permButton('invoice.void', { label: 'Void', cls: 'btn btn-ghost btn-danger-ghost', action: 'void', iconName: 'ban' }));
      actions.push(permButton('invoice.create', { label: 'Duplicate', cls: 'btn', action: 'duplicate', iconName: 'copy' }));
      actions.push(`<button type="button" class="btn" data-action="print">${icon('print')}<span>Print or save PDF</span></button>`);
      if (canPay) actions.push(permButton('payment.record', { label: 'Record payment', cls: 'btn btn-primary', action: 'pay', iconName: 'cash' }));
    }
    const paidPct = inv.totals.total ? Math.min(100, (inv.paid / inv.totals.total) * 100) : 0;
    const userName = (id) => USERS.find((u) => u.id === id)?.name ?? '—';

    root.innerHTML = `
    <div class="page-head">
      <div>
        <nav class="crumb" aria-label="Breadcrumb"><a href="#/invoices">Invoices</a><span aria-hidden="true">/</span><span class="mono" aria-current="page">${esc(inv.number)}</span></nav>
        <h1 style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="mono" style="font-weight:500">${esc(inv.number)}</span> ${badge(inv.status)}</h1>
        <p class="sub"><a href="#/customers/${encodeURIComponent(inv.customerId)}">${esc(inv.customerName)}</a> · ${esc(formatMoney(inv.totals.total, inv.currency))}${inv.status === 'overdue' ? ` · <span style="color:var(--danger-text)">${inv.daysOverdue} days overdue</span>` : ''}</p>
      </div>
      <div class="page-actions detail-actions">${actions.join('')}</div>
    </div>
    ${inv.status === 'void' ? `<div class="notice notice-danger" role="note"><strong>This invoice is void.</strong> ${esc(inv.voidReason)}</div>` : ''}
    ${isDraft ? `<div class="notice" role="note"><strong>Draft.</strong> The customer hasn’t received this invoice yet. Send it to start the payment clock.</div>` : ''}
    <div class="detail-grid">
      ${documentHTML(inv, customer)}
      <div class="side-stack">
        <section class="card" aria-labelledby="h-sum">
          <div class="card-head"><h2 id="h-sum">Summary</h2>${badge(inv.status)}</div>
          <div class="card-body">
            <dl class="summary-list">
              <div><dt>Total</dt><dd>${esc(formatMoney(inv.totals.total, inv.currency))}</dd></div>
              <div><dt>Paid</dt><dd>${esc(formatMoney(inv.paid, inv.currency))}</dd></div>
              <div class="strong"><dt>Balance due</dt><dd data-testid="balance">${esc(formatMoney(inv.balance, inv.currency))}</dd></div>
            </dl>
            ${!isDraft && inv.status !== 'void' ? `<div class="progress" role="progressbar" aria-label="Amount paid" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${paidPct.toFixed(0)}"><span style="width:${paidPct}%"></span></div><p class="small muted">${paidPct.toFixed(0)}% paid · due ${esc(formatDate(inv.dueDate))}</p>` : ''}
          </div>
        </section>
        <section class="card" aria-labelledby="h-pay">
          <div class="card-head"><h2 id="h-pay">Payments</h2><span class="meta">${plural(inv.payments.length, 'payment')}</span></div>
          ${inv.payments.length ? `<ul class="pay-list">${inv.payments.map((p) => `<li>
              <span>${esc(formatDate(p.date))} · ${esc(p.method)}</span><span class="amt">${esc(formatMoney(p.amount, inv.currency))}</span>
              <span class="meta">${p.reference ? `Ref <span class="mono">${esc(p.reference)}</span> · ` : ''}Recorded by ${esc(userName(p.recordedBy))}</span></li>`).join('')}</ul>`
            : `<p class="small muted" style="padding:14px 18px">${isDraft ? 'Payments can be recorded after the invoice is sent.' : inv.status === 'void' ? 'No payments. This invoice is void.' : 'No payments recorded yet.'}</p>`}
        </section>
        <section class="card" aria-labelledby="h-act">
          <div class="card-head"><h2 id="h-act">Activity</h2></div>
          ${renderTimeline(store.getAuditFor('invoice', inv.id))}
        </section>
      </div>
    </div>`;
  }

  async function onClick(e) {
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (!act || e.target.closest('[aria-disabled="true"]')) return;
    try {
      if (act === 'print') window.print();
      if (act === 'edit') location.hash = `#/invoices/${encodeURIComponent(inv.id)}/edit`;
      if (act === 'send') {
        store.sendInvoice(inv.id);
        const id = inv.id;
        toast(`${id} sent to ${store.getCustomer(inv.customerId)?.email ?? 'the customer'}.`, { undo: () => {
          const back = store.undoSend([id]);
          toast(back.length ? `${id} moved back to draft.` : `${id} can’t go back to draft because a payment has been recorded.`, { error: !back.length });
        } });
      }
      if (act === 'duplicate') {
        const n = store.duplicateInvoice(inv.id);
        toast(`Created draft ${n} from ${inv.number}.`);
        location.hash = `#/invoices/${encodeURIComponent(n)}/edit`;
      }
      if (act === 'delete') {
        const ok = await confirmDialog({
          title: `Delete draft ${inv.number}?`,
          message: 'The draft and its line items will be removed. This can’t be undone, but the deletion stays in the audit log.',
          confirmLabel: 'Delete draft',
        });
        if (ok) {
          const n = inv.number;
          store.deleteDraft(inv.id);
          toast(`Deleted draft ${n}.`);
          location.hash = '#/invoices';
        }
      }
      if (act === 'void') await voidFlow();
      if (act === 'pay') await payFlow();
    } catch (err) {
      toast(errorMessage(err), { error: true });
    }
  }

  function voidFlow() {
    return openDialog({
      title: `Void ${inv.number}?`,
      submitLabel: 'Void invoice',
      submitClass: 'btn btn-danger',
      body: `<p class="lead">Voiding cancels the invoice and removes ${esc(formatMoney(inv.balance, inv.currency))} from receivables. The invoice number can’t be reused, and this can’t be undone.</p>
        <div class="field"><label for="void-reason">Reason for voiding</label>
        <textarea id="void-reason" name="reason" class="input" rows="3" required placeholder="For example: raised against the wrong purchase order" aria-describedby="err-reason"></textarea>${errSlot('reason')}
        <span class="hint">The reason is shown on the invoice and recorded in the audit log.</span></div>`,
      onSubmit: (form) => {
        store.voidInvoice(inv.id, form.reason.value);
        toast(`${inv.number} voided.`);
        return true;
      },
    });
  }

  function payFlow() {
    const fresh = store.getInvoice(inv.id);
    return openDialog({
      title: `Record payment for ${fresh.number}`,
      submitLabel: 'Record payment',
      body: `<p class="lead">Balance due is <strong class="mono">${esc(formatMoney(fresh.balance, fresh.currency))}</strong>. Partial payments are fine.</p>
        <div class="dlg-grid">
          <div class="field"><label for="pay-amount">Amount (${esc(fresh.currency)})</label>
            <input id="pay-amount" name="amount" class="input num-input" inputmode="decimal" autocomplete="off" value="${centsToDecimal(fresh.balance)}" aria-describedby="err-amount">${errSlot('amount')}</div>
          <div class="field"><label for="pay-date">Date received</label>
            <input id="pay-date" name="date" type="date" class="input" value="${todayISO()}" max="${todayISO()}" min="${esc(fresh.issueDate)}" aria-describedby="err-date">${errSlot('date')}</div>
          <div class="field"><label for="pay-method">Method</label>
            <select id="pay-method" name="method" class="input">${PAYMENT_METHODS.map((m) => `<option>${esc(m)}</option>`).join('')}</select>${errSlot('method')}</div>
          <div class="field"><label for="pay-ref">Reference <span class="muted">(optional)</span></label>
            <input id="pay-ref" name="reference" class="input" autocomplete="off" maxlength="80" placeholder="Bank or cheque reference"></div>
        </div>`,
      onOpen: (dlg) => dlg.querySelector('#pay-amount').select(),
      onSubmit: (form) => {
        const raw = form.amount.value;
        const amount = parseAmount(raw);
        if (amount == null) throw new store.ValidationError({ amount: 'Enter the amount as a number with up to 2 decimals, like 1250.00.' });
        const after = store.recordPayment(fresh.id, { amount, date: form.date.value, method: form.method.value, reference: form.reference.value });
        toast(after.status === 'paid'
          ? `Recorded ${formatMoney(amount, fresh.currency)}. ${fresh.number} is now paid in full.`
          : `Recorded ${formatMoney(amount, fresh.currency)}. ${formatMoney(after.balance, fresh.currency)} still due.`);
        return true;
      },
    });
  }

  root.addEventListener('click', onClick);
  draw();
  return {
    onStoreChange: draw,
    destroy() {
      root.removeEventListener('click', onClick);
    },
  };
}
