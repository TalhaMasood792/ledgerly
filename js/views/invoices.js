import * as store from '../store.js';
import { esc, formatMoney, formatDate, centsToDecimal, todayISO, plural, isISODate } from '../format.js';
import { STATUS_LABELS, STATUS_ORDER } from '../invoice-math.js';
import { can } from '../permissions.js';
import { setTitle, permButton, icon, badge, toast, errorMessage, sortHeader, pager, toCSV, downloadFile } from '../ui.js';

const PAGE_SIZE = 25;
const SORTS = {
  number: (a, b) => a.number.localeCompare(b.number),
  customer: (a, b) => a.customerName.localeCompare(b.customerName),
  issue: (a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number),
  due: (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number),
  total: (a, b) => a.totals.total - b.totals.total,
  balance: (a, b) => a.balance - b.balance,
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
};
const DEFAULT_DIR = { number: 'desc', customer: 'asc', issue: 'desc', due: 'asc', total: 'desc', balance: 'desc', status: 'asc' };

function readState(q) {
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'issue';
  return {
    q: q.get('q') || '',
    statuses: new Set((q.get('status') || '').split(',').filter((s) => STATUS_LABELS[s])),
    customer: q.get('customer') || '',
    from: isISODate(q.get('from') || '') ? q.get('from') : '',
    to: isISODate(q.get('to') || '') ? q.get('to') : '',
    sort,
    dir: q.get('dir') === 'asc' || q.get('dir') === 'desc' ? q.get('dir') : DEFAULT_DIR[sort],
    page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
  };
}
function writeState(s) {
  const q = new URLSearchParams();
  if (s.q) q.set('q', s.q);
  if (s.statuses.size) q.set('status', [...s.statuses].join(','));
  if (s.customer) q.set('customer', s.customer);
  if (s.from) q.set('from', s.from);
  if (s.to) q.set('to', s.to);
  if (s.sort !== 'issue' || s.dir !== 'desc') {
    q.set('sort', s.sort);
    q.set('dir', s.dir);
  }
  if (s.page > 1) q.set('page', String(s.page));
  const qs = q.toString();
  history.replaceState(null, '', '#/invoices' + (qs ? '?' + qs : ''));
}

function applyFilters(all, s) {
  const needle = s.q.trim().toLowerCase();
  let rows = all.filter((i) => {
    if (s.statuses.size && !s.statuses.has(i.status)) return false;
    if (s.customer && i.customerId !== s.customer) return false;
    if (s.from && i.issueDate < s.from) return false;
    if (s.to && i.issueDate > s.to) return false;
    if (needle) {
      const hay = `${i.number} ${i.customerName} ${i.reference || ''} ${i.currency}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const cmp = SORTS[s.sort];
  rows.sort((a, b) => (s.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
  return rows;
}

export function exportCSV(rows, filename) {
  const header = ['Invoice number', 'Customer', 'Status', 'Currency', 'Issue date', 'Due date', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance due', 'Reference'];
  const data = rows.map((i) => [i.number, i.customerName, STATUS_LABELS[i.status], i.currency, i.issueDate, i.dueDate, centsToDecimal(i.totals.subtotal), centsToDecimal(i.totals.discount), centsToDecimal(i.totals.tax), centsToDecimal(i.totals.total), centsToDecimal(i.paid), centsToDecimal(i.balance), i.reference || '']);
  downloadFile(filename, toCSV([header, ...data]));
}

export function render(root, params) {
  setTitle('Invoices');
  const s = readState(params.query);
  const selected = new Set();
  let all = store.getInvoices();

  root.innerHTML = `
  <div class="page-head">
    <div><h1>Invoices</h1><p class="sub" id="inv-sub"></p></div>
    <div class="page-actions">
      <button type="button" class="btn" data-action="export-all">${icon('download')}<span>Export filtered CSV</span></button>
      ${permButton('invoice.create', { label: 'New invoice', cls: 'btn btn-primary', action: 'new', iconName: 'plus' })}
    </div>
  </div>
  <section class="card" aria-label="Invoice list">
    <form class="toolbar" role="search" id="filters" onsubmit="return false">
      <div class="search-row">
        <div class="field grow"><label for="f-q">Search</label>
          <div class="search">${icon('search')}<input id="f-q" class="input" type="search" placeholder="Invoice number, customer or PO" value="${esc(s.q)}" autocomplete="off"></div></div>
        <button type="button" class="btn filter-toggle" data-action="toggle-filters" aria-expanded="false" aria-controls="more-filters">${icon('filter')}<span>Filters</span><span class="mono small" id="filter-n"></span></button>
      </div>
      <div class="more-filters" id="more-filters">
        <div class="field"><label for="f-customer">Customer</label>
          <select id="f-customer" class="input"><option value="">All customers</option>${store.getCustomers().slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${esc(c.id)}" ${c.id === s.customer ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="date-pair">
          <div class="field"><label for="f-from">Issued from</label><input id="f-from" class="input" type="date" value="${esc(s.from)}"></div>
          <div class="field"><label for="f-to">Issued to</label><input id="f-to" class="input" type="date" value="${esc(s.to)}"></div>
        </div>
        <div class="field mobile-sort"><label for="f-sort">Sort by</label>
          <select id="f-sort" class="input">${[['issue', 'desc', 'Newest issued'], ['issue', 'asc', 'Oldest issued'], ['due', 'asc', 'Due date, soonest'], ['balance', 'desc', 'Balance due, highest'], ['total', 'desc', 'Total, highest'], ['customer', 'asc', 'Customer A–Z'], ['number', 'desc', 'Invoice number']].map(([k, d, l]) => `<option value="${k}:${d}">${l}</option>`).join('')}</select></div>
      </div>
    </form>
    <div class="chips" role="group" aria-label="Filter by status">
      <span class="chips-label">Status</span>
      ${STATUS_ORDER.map((st) => `<button type="button" class="chip" data-status="${st}" aria-pressed="${s.statuses.has(st)}">${STATUS_LABELS[st]} <span class="c-n" data-count="${st}"></span></button>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-action="clear" id="clear-top">Clear filters</button>
    </div>
    <div id="bulk"></div>
    <div id="table"></div>
  </section>`;

  const $ = (sel) => root.querySelector(sel);
  let rows = [];

  function syncControls() {
    $('#f-q').value = s.q;
    $('#f-customer').value = s.customer;
    $('#f-from').value = s.from;
    $('#f-to').value = s.to;
    root.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(s.statuses.has(b.dataset.status))));
    const ms = $('#f-sort');
    const v = `${s.sort}:${s.dir}`;
    if (![...ms.options].some((o) => o.value === v)) ms.insertAdjacentHTML('beforeend', `<option value="${v}">Custom (${s.sort})</option>`);
    ms.value = v;
  }

  function hasFilters() {
    return !!(s.q || s.statuses.size || s.customer || s.from || s.to);
  }

  function draw() {
    all = store.getInvoices();
    rows = applyFilters(all, s);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
    writeState(s);

    const base = applyFilters(all, { ...s, statuses: new Set() });
    STATUS_ORDER.forEach((st) => {
      const el = root.querySelector(`[data-count="${st}"]`);
      if (el) el.textContent = base.filter((i) => i.status === st).length;
    });
    $('#clear-top').hidden = !hasFilters();
    const nAdv = (s.customer ? 1 : 0) + (s.from ? 1 : 0) + (s.to ? 1 : 0);
    $('#filter-n').textContent = nAdv ? `(${nAdv})` : '';
    const openBal = rows.filter((r) => r.balance > 0).length;
    $('#inv-sub').textContent = `${plural(rows.length, 'invoice')}${hasFilters() ? ' match your filters' : ''} · ${openBal} with a balance due`;

    const pageRows = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
    const someOnPage = pageRows.some((r) => selected.has(r.id));

    if (!rows.length) {
      $('#table').innerHTML = `<div class="empty">${icon('filter')}<h2>No invoices match these filters</h2><p>Try a different search or remove a filter to see more invoices.</p><button type="button" class="btn" data-action="clear">Clear filters</button></div>`;
    } else {
      $('#table').innerHTML = `<div class="tbl-scroll"><table class="tbl tbl-cards" id="inv-table">
        <caption class="sr-only">Invoices, sorted by ${esc(s.sort)} ${s.dir === 'asc' ? 'ascending' : 'descending'}</caption>
        <thead><tr>
          <th scope="col" class="col-check"><input type="checkbox" class="checkbox" id="sel-page" aria-label="Select all invoices on this page" ${allOnPage ? 'checked' : ''}></th>
          ${sortHeader('number', 'Number', s)}${sortHeader('customer', 'Customer', s)}${sortHeader('issue', 'Issue date', s)}${sortHeader('due', 'Due date', s)}${sortHeader('total', 'Total', s, { num: true })}${sortHeader('balance', 'Balance due', s, { num: true })}${sortHeader('status', 'Status', s)}
        </tr></thead>
        <tbody>${pageRows.map((i) => `<tr class="clickable ${selected.has(i.id) ? 'is-selected' : ''}" data-id="${esc(i.id)}">
          <td class="col-check td-check"><input type="checkbox" class="checkbox" data-select="${esc(i.id)}" aria-label="Select ${esc(i.number)}" ${selected.has(i.id) ? 'checked' : ''}></td>
          <td class="td-num"><a class="inv-link" href="#/invoices/${encodeURIComponent(i.id)}">${esc(i.number)}</a></td>
          <td class="td-cust"><span class="cell-strong">${esc(i.customerName)}</span></td>
          <td class="td-issue mono small">${esc(formatDate(i.issueDate))}</td>
          <td class="td-due ${i.status === 'overdue' ? '' : ''}"><span class="mono small">${esc(formatDate(i.dueDate))}</span>${i.status === 'overdue' ? `<span class="sub" style="color:var(--danger-text)">${i.daysOverdue} days overdue</span>` : ''}</td>
          <td class="num td-total">${esc(formatMoney(i.totals.total, i.currency))}</td>
          <td class="num td-bal ${i.balance === 0 ? 'balance-zero' : ''}">${i.status === 'draft' || i.status === 'void' ? '<span aria-label="Not applicable">—</span>' : esc(formatMoney(i.balance, i.currency))}</td>
          <td class="td-status">${badge(i.status)}</td>
        </tr>`).join('')}</tbody></table></div>
        ${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length })}`;
      const sp = $('#sel-page');
      if (sp) sp.indeterminate = !allOnPage && someOnPage;
    }
    drawBulk();
  }

  function drawBulk() {
    if (!selected.size) {
      $('#bulk').innerHTML = '';
      return;
    }
    const drafts = [...selected].filter((id) => all.find((i) => i.id === id)?.status === 'draft').length;
    $('#bulk').innerHTML = `<div class="bulkbar" role="region" aria-label="Bulk actions">
      <span class="count">${selected.size} selected</span>
      ${permButton('invoice.send', { label: drafts ? `Mark ${drafts === 1 ? '1 draft' : drafts + ' drafts'} as sent` : 'Mark as sent', cls: 'btn btn-sm', action: 'bulk-send', iconName: 'send', attrs: drafts ? '' : 'disabled title="Only drafts can be marked as sent. None of the selected invoices are drafts."' })}
      <button type="button" class="btn btn-sm" data-action="bulk-export">${icon('download')}<span>Export CSV</span></button>
      ${rows.length > selected.size ? `<button type="button" class="btn btn-ghost btn-sm" data-action="select-all">Select all ${rows.length}</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-action="deselect">Clear selection</button>
    </div>`;
  }

  // ---------- events ----------
  let qTimer;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      s.q = e.target.value;
      s.page = 1;
      draw();
    }, 150);
  });
  $('#f-customer').addEventListener('change', (e) => {
    s.customer = e.target.value;
    s.page = 1;
    draw();
  });
  $('#f-from').addEventListener('change', (e) => {
    s.from = e.target.value;
    s.page = 1;
    draw();
  });
  $('#f-to').addEventListener('change', (e) => {
    s.to = e.target.value;
    s.page = 1;
    draw();
  });
  $('#f-sort').addEventListener('change', (e) => {
    const [k, d] = e.target.value.split(':');
    s.sort = k;
    s.dir = d;
    draw();
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sel-page') {
      const pageRows = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
      pageRows.forEach((r) => (t.checked ? selected.add(r.id) : selected.delete(r.id)));
      draw();
    } else if (t.dataset.select) {
      t.checked ? selected.add(t.dataset.select) : selected.delete(t.dataset.select);
      t.closest('tr').classList.toggle('is-selected', t.checked);
      const pageRows = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
      const sp = $('#sel-page');
      if (sp) {
        const all = pageRows.every((r) => selected.has(r.id));
        sp.checked = all;
        sp.indeterminate = !all && pageRows.some((r) => selected.has(r.id));
      }
      drawBulk();
    }
  });

  root.addEventListener('click', (e) => {
    const t = e.target;
    const st = t.closest('[data-status]');
    if (st) {
      const v = st.dataset.status;
      s.statuses.has(v) ? s.statuses.delete(v) : s.statuses.add(v);
      s.page = 1;
      syncControls();
      draw();
      return;
    }
    const sortBtn = t.closest('[data-sort]');
    if (sortBtn) {
      const k = sortBtn.dataset.sort;
      if (s.sort === k) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
      else {
        s.sort = k;
        s.dir = DEFAULT_DIR[k];
      }
      syncControls();
      draw();
      root.querySelector(`[data-sort="${k}"]`)?.focus();
      return;
    }
    const pg = t.closest('[data-page]');
    if (pg && !pg.disabled) {
      s.page = Number(pg.dataset.page);
      draw();
      root.querySelector('#inv-table')?.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    const act = t.closest('[data-action]')?.dataset.action;
    if (act === 'clear') {
      Object.assign(s, { q: '', statuses: new Set(), customer: '', from: '', to: '', page: 1 });
      syncControls();
      draw();
      $('#f-q').focus();
      return;
    }
    if (act === 'toggle-filters') {
      const tb = $('#filters');
      const open = tb.classList.toggle('is-open');
      t.closest('[data-action]').setAttribute('aria-expanded', String(open));
      return;
    }
    if (act === 'new') return void (location.hash = '#/invoices/new');
    if (act === 'export-all') {
      exportCSV(rows, `ledgerly-invoices-${todayISO()}.csv`);
      toast(`Exported ${plural(rows.length, 'invoice')} to CSV.`);
      return;
    }
    if (act === 'bulk-export') {
      const sel = rows.filter((r) => selected.has(r.id));
      exportCSV(sel, `ledgerly-invoices-selected-${todayISO()}.csv`);
      toast(`Exported ${plural(sel.length, 'invoice')} to CSV.`);
      return;
    }
    if (act === 'select-all') {
      rows.forEach((r) => selected.add(r.id));
      draw();
      return;
    }
    if (act === 'deselect') {
      selected.clear();
      draw();
      return;
    }
    if (act === 'bulk-send') {
      try {
        const res = store.sendInvoices([...selected]);
        selected.clear();
        const msg = `Marked ${plural(res.sent.length, 'invoice')} as sent${res.skipped.length ? `. Skipped ${res.skipped.length} that weren’t drafts` : ''}.`;
        toast(msg, { undo: () => {
          const back = store.undoSend(res.sent);
          toast(back.length === res.sent.length ? `Moved ${plural(back.length, 'invoice')} back to draft.` : `Moved ${back.length} of ${res.sent.length} back to draft. The rest already have payments recorded.`);
        } });
      } catch (err) {
        toast(errorMessage(err), { error: true });
      }
      return;
    }
    // Row click opens the detail (ignoring controls inside the row).
    const tr = t.closest('tr.clickable');
    if (tr && !t.closest('input, a, button, label')) location.hash = `#/invoices/${encodeURIComponent(tr.dataset.id)}`;
  });

  syncControls();
  draw();
  return {
    onStoreChange() {
      draw();
    },
  };
}
