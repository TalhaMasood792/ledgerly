import * as store from '../store.js';
import { esc, formatMoney, formatDate, plural } from '../format.js';
import { termsLabel } from '../invoice-math.js';
import { setTitle, permButton, badge, renderTimeline } from '../ui.js';
import { openCustomerDialog } from './customer-form.js';
import * as notFound from './not-found.js';

export function render(root, params) {
  if (!store.getCustomer(params.id)) return notFound.render(root, { ...params, kind: 'customer' });

  function draw() {
    const c = store.getCustomer(params.id);
    if (!c) return;
    setTitle(c.name);
    const b = store.customerBalances(c.id);
    const invs = store.getInvoices().filter((i) => i.customerId === c.id).sort((x, y) => y.issueDate.localeCompare(x.issueDate) || y.number.localeCompare(x.number));
    const a = c.address;
    root.innerHTML = `
    <div class="page-head">
      <div>
        <nav class="crumb" aria-label="Breadcrumb"><a href="#/customers">Customers</a><span aria-hidden="true">/</span><span aria-current="page">${esc(c.name)}</span></nav>
        <h1>${esc(c.name)}</h1>
        <p class="sub">${esc([a.city, a.country].filter(Boolean).join(', '))} · ${c.currency} · ${esc(termsLabel(c.terms))}</p>
      </div>
      <div class="page-actions">
        ${permButton('customer.edit', { label: 'Edit customer', cls: 'btn', action: 'edit', iconName: 'edit' })}
        ${permButton('invoice.create', { label: 'New invoice', cls: 'btn btn-primary', action: 'new-invoice', iconName: 'plus' })}
      </div>
    </div>
    <div class="mini-kpis">
      <div class="card kpi"><div class="kpi-label">Open balance</div><div class="kpi-value">${esc(formatMoney(b.open, b.currency))}</div><div class="kpi-foot">${plural(b.openCount, 'open invoice')}</div></div>
      <div class="card kpi ${b.overdue ? 'is-alert' : ''}"><div class="kpi-label">Overdue</div><div class="kpi-value">${esc(formatMoney(b.overdue, b.currency))}</div><div class="kpi-foot">${plural(b.overdueCount, 'invoice')} past due</div></div>
      <div class="card kpi"><div class="kpi-label">Paid to date</div><div class="kpi-value">${esc(formatMoney(b.paid, b.currency))}</div><div class="kpi-foot">${plural(b.invoiceCount, 'invoice')} in total</div></div>
    </div>
    <div class="cust-grid">
      <div class="side-stack">
        <section class="card" aria-labelledby="h-contact">
          <div class="card-head"><h2 id="h-contact">Contact and billing</h2></div>
          <div class="card-body"><dl class="kv">
            <div><dt>Contact</dt><dd>${esc(c.contactName || '—')}</dd></div>
            <div><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>
            <div><dt>Phone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : '—'}</dd></div>
            <div><dt>Address</dt><dd>${[a.line1, a.line2, [a.city, a.region, a.postal].filter(Boolean).join(', '), a.country].filter(Boolean).map(esc).join('<br>') || '—'}</dd></div>
            <div><dt>Tax ID</dt><dd class="mono small">${esc(c.taxId || '—')}</dd></div>
            <div><dt>Default tax</dt><dd>${c.taxRate}%</dd></div>
          </dl></div>
        </section>
        <section class="card" aria-labelledby="h-cact">
          <div class="card-head"><h2 id="h-cact">Activity</h2></div>
          ${renderTimeline(store.getAuditFor('customer', c.id))}
        </section>
      </div>
      <section class="card" aria-labelledby="h-cinv">
        <div class="card-head"><h2 id="h-cinv">Invoices</h2><a class="btn btn-sm" href="#/invoices?customer=${encodeURIComponent(c.id)}">Open in invoice list</a></div>
        ${invs.length ? `<div class="tbl-scroll"><table class="tbl tbl-cards no-check">
          <caption class="sr-only">Invoices for ${esc(c.name)}</caption>
          <thead><tr><th scope="col">Number</th><th scope="col" class="td-issue">Issue date</th><th scope="col">Due date</th><th scope="col" class="num">Total</th><th scope="col" class="num">Balance due</th><th scope="col">Status</th></tr></thead>
          <tbody>${invs.map((i) => `<tr class="clickable" data-id="${esc(i.id)}">
            <td class="td-num"><a class="inv-link" href="#/invoices/${encodeURIComponent(i.id)}">${esc(i.number)}</a></td>
            <td class="td-issue mono small">${esc(formatDate(i.issueDate))}</td>
            <td class="td-due mono small">${esc(formatDate(i.dueDate))}</td>
            <td class="num td-total">${esc(formatMoney(i.totals.total, i.currency))}</td>
            <td class="num td-bal ${i.balance ? '' : 'balance-zero'}">${i.status === 'draft' || i.status === 'void' ? '—' : esc(formatMoney(i.balance, i.currency))}</td>
            <td class="td-status">${badge(i.status)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty"><h2>No invoices yet</h2><p>Invoices you create for this customer will appear here.</p></div>'}
      </section>
    </div>`;
  }

  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[aria-disabled="true"]')) return;
    const act = t.closest('[data-action]')?.dataset.action;
    if (act === 'edit') await openCustomerDialog(store.getCustomer(params.id));
    if (act === 'new-invoice') location.hash = `#/invoices/new?customer=${encodeURIComponent(params.id)}`;
    const tr = t.closest('tr.clickable');
    if (tr && !t.closest('a, button')) location.hash = `#/invoices/${encodeURIComponent(tr.dataset.id)}`;
  });
  draw();
  return { onStoreChange: draw };
}
