import * as store from '../store.js';
import { esc, formatMoney, plural, toBase } from '../format.js';
import { setTitle, permButton, icon, sortHeader } from '../ui.js';
import { openCustomerDialog } from './customer-form.js';

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  email: (a, b) => a.email.localeCompare(b.email),
  open: (a, b) => a.openUSD - b.openUSD,
  overdue: (a, b) => a.overdueUSD - b.overdueUSD,
  count: (a, b) => a.b.invoiceCount - b.b.invoiceCount,
};

export function render(root, params) {
  setTitle('Customers');
  const s = { q: params.query.get('q') || '', sort: SORTS[params.query.get('sort')] ? params.query.get('sort') : 'open', dir: params.query.get('dir') === 'asc' ? 'asc' : 'desc' };
  if (!params.query.get('dir') && s.sort === 'name') s.dir = 'asc';

  root.innerHTML = `
  <div class="page-head">
    <div><h1>Customers</h1><p class="sub" id="c-sub"></p></div>
    <div class="page-actions">${permButton('customer.create', { label: 'Add customer', cls: 'btn btn-primary', action: 'add', iconName: 'plus' })}</div>
  </div>
  <section class="card" aria-label="Customer list">
    <div class="toolbar"><div class="field grow"><label for="c-q">Search</label><div class="search">${icon('search')}<input id="c-q" type="search" class="input" placeholder="Company, contact, email or country" value="${esc(s.q)}" autocomplete="off"></div></div></div>
    <div id="c-table"></div>
  </section>`;

  const $ = (x) => root.querySelector(x);

  function draw() {
    const needle = s.q.trim().toLowerCase();
    let rows = store.getCustomers().map((c) => {
      const b = store.customerBalances(c.id);
      return { ...c, b, openUSD: toBase(b.open, b.currency), overdueUSD: toBase(b.overdue, b.currency) };
    });
    if (needle) rows = rows.filter((c) => `${c.name} ${c.contactName} ${c.email} ${c.address.country} ${c.address.city}`.toLowerCase().includes(needle));
    const cmp = SORTS[s.sort];
    rows.sort((a, b) => (s.dir === 'asc' ? cmp(a, b) : -cmp(a, b)) || a.name.localeCompare(b.name));
    const qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q);
    if (s.sort !== 'open' || s.dir !== 'desc') (qs.set('sort', s.sort), qs.set('dir', s.dir));
    history.replaceState(null, '', '#/customers' + (qs.toString() ? '?' + qs : ''));
    $('#c-sub').textContent = `${plural(rows.length, 'customer')}${needle ? ' match your search' : ''}. Balances shown in each customer’s currency; sorting uses USD equivalents.`;
    if (!rows.length) {
      $('#c-table').innerHTML = `<div class="empty">${icon('search')}<h2>No customers match “${esc(s.q)}”</h2><p>Check the spelling or search by email or country.</p><button type="button" class="btn" data-action="clear">Clear search</button></div>`;
      return;
    }
    $('#c-table').innerHTML = `<div class="tbl-scroll"><table class="tbl tbl-customers">
      <caption class="sr-only">Customers</caption>
      <thead><tr>${sortHeader('name', 'Customer', s)}${sortHeader('email', 'Contact email', s)}${sortHeader('open', 'Open balance', s, { num: true })}${sortHeader('overdue', 'Overdue', s, { num: true })}${sortHeader('count', 'Invoices', s, { num: true })}</tr></thead>
      <tbody>${rows.map((c) => `<tr class="clickable" data-id="${esc(c.id)}">
        <td><a class="cell-strong" style="color:var(--ink)" href="#/customers/${encodeURIComponent(c.id)}">${esc(c.name)}</a><span class="sub">${esc([c.address.city, c.address.country].filter(Boolean).join(', '))} · ${c.currency}</span></td>
        <td><span class="small">${esc(c.email)}</span><span class="sub">${esc(c.contactName || '')}</span></td>
        <td class="num mono ${c.b.open ? '' : 'balance-zero'}">${esc(formatMoney(c.b.open, c.b.currency))}</td>
        <td class="num mono" style="${c.b.overdue ? 'color:var(--danger-text)' : ''}"><span class="${c.b.overdue ? '' : 'balance-zero'}">${esc(formatMoney(c.b.overdue, c.b.currency))}</span></td>
        <td class="num mono">${c.b.invoiceCount}</td></tr>`).join('')}</tbody></table></div>`;
  }

  let timer;
  $('#c-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      s.q = e.target.value;
      draw();
    }, 120);
  });
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const sb = t.closest('[data-sort]');
    if (sb) {
      const k = sb.dataset.sort;
      if (s.sort === k) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
      else (s.sort = k), (s.dir = k === 'name' || k === 'email' ? 'asc' : 'desc');
      draw();
      root.querySelector(`[data-sort="${k}"]`)?.focus();
      return;
    }
    const act = t.closest('[data-action]')?.dataset.action;
    if (act === 'clear') {
      s.q = '';
      $('#c-q').value = '';
      draw();
      $('#c-q').focus();
      return;
    }
    if (act === 'add' && !t.closest('[aria-disabled="true"]')) {
      const id = await openCustomerDialog();
      if (id) location.hash = `#/customers/${encodeURIComponent(id)}`;
      return;
    }
    const tr = t.closest('tr.clickable');
    if (tr && !t.closest('a, button')) location.hash = `#/customers/${encodeURIComponent(tr.dataset.id)}`;
  });
  draw();
  return { onStoreChange: draw };
}
