import * as store from '../store.js';
import { esc, formatDateTime, plural, todayISO } from '../format.js';
import { ROLE_LABELS, USERS } from '../permissions.js';
import { setTitle, icon, renderChanges, pager, toCSV, downloadFile, toast } from '../ui.js';

const PAGE_SIZE = 25;

export function render(root, params) {
  setTitle('Audit log');
  const q = params.query;
  const s = { q: q.get('q') || '', user: q.get('user') || '', action: q.get('action') || '', entity: q.get('entity') || '', page: Math.max(1, Number(q.get('page')) || 1) };

  root.innerHTML = `
  <div class="page-head">
    <div><h1>Audit log</h1><p class="sub">Every change to invoices, payments and customers, newest first. Entries can’t be edited or deleted.</p></div>
    <div class="page-actions"><button type="button" class="btn" data-action="export">${icon('download')}<span>Export filtered CSV</span></button></div>
  </div>
  <section class="card" aria-label="Audit entries">
    <form class="toolbar" role="search" onsubmit="return false">
      <div class="field grow"><label for="a-q">Search</label><div class="search">${icon('search')}<input id="a-q" type="search" class="input" placeholder="Invoice number, customer or detail" value="${esc(s.q)}" autocomplete="off"></div></div>
      <div class="field"><label for="a-user">User</label><select id="a-user" class="input"><option value="">All users</option>${USERS.map((u) => `<option value="${u.id}" ${u.id === s.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="a-action">Action</label><select id="a-action" class="input"><option value="">All actions</option>${Object.entries(store.ACTION_LABELS).map(([k, v]) => `<option value="${k}" ${k === s.action ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="a-entity">Entity</label><select id="a-entity" class="input"><option value="">All entities</option><option value="invoice" ${s.entity === 'invoice' ? 'selected' : ''}>Invoices</option><option value="customer" ${s.entity === 'customer' ? 'selected' : ''}>Customers</option></select></div>
    </form>
    <div id="a-table"></div>
  </section>`;
  const $ = (x) => root.querySelector(x);
  let rows = [];

  function filter() {
    const needle = s.q.trim().toLowerCase();
    return store.getAudit().filter((a) => {
      if (s.user && a.userId !== s.user) return false;
      if (s.action && a.action !== s.action) return false;
      if (s.entity && a.entityType !== s.entity) return false;
      if (needle) {
        const hay = `${a.entityLabel} ${a.who} ${a.note} ${store.ACTION_LABELS[a.action]} ${(a.changes || []).map((c) => `${c.field} ${typeof c.from === 'string' ? c.from : ''} ${typeof c.to === 'string' ? c.to : ''}`).join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).slice().reverse();
  }

  function draw() {
    rows = filter();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    const qs = new URLSearchParams(Object.entries(s).filter(([k, v]) => v && !(k === 'page' && v === 1)));
    history.replaceState(null, '', '#/audit' + (qs.toString() ? '?' + qs : ''));
    if (!rows.length) {
      $('#a-table').innerHTML = `<div class="empty">${icon('filter')}<h2>No audit entries match these filters</h2><p>Remove a filter or search for something else.</p><button type="button" class="btn" data-action="clear">Clear filters</button></div>`;
      return;
    }
    const pageRows = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    $('#a-table').innerHTML = `<div class="tbl-scroll"><table class="tbl" style="min-width:820px">
      <caption class="sr-only">Audit entries, newest first</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Change</th></tr></thead>
      <tbody>${pageRows.map((a) => {
        const u = USERS.find((x) => x.id === a.userId);
        const href = a.entityType === 'invoice' ? (a.action === 'invoice.deleted' ? '' : `#/invoices/${encodeURIComponent(a.entityId)}`) : `#/customers/${encodeURIComponent(a.entityId)}`;
        const exists = a.entityType === 'invoice' ? !!store.getInvoice(a.entityId) : !!store.getCustomer(a.entityId);
        return `<tr>
          <td class="when"><time datetime="${esc(a.at)}">${esc(formatDateTime(a.at))}</time></td>
          <td><span class="audit-who"><span class="avatar" data-role="${a.role}" aria-hidden="true">${esc(u?.initials || '?')}</span><span>${esc(a.who)}<span class="sub role-tag">${esc(ROLE_LABELS[a.role])}</span></span></span></td>
          <td>${esc(store.ACTION_LABELS[a.action] || a.action)}</td>
          <td>${href && exists ? `<a class="${a.entityType === 'invoice' ? 'mono' : ''}" href="${href}">${esc(a.entityLabel)}</a>` : `<span class="${a.entityType === 'invoice' ? 'mono' : ''}">${esc(a.entityLabel)}</span>`}<span class="sub">${a.entityType === 'invoice' ? 'Invoice' : 'Customer'}</span></td>
          <td>${renderChanges(a.changes)}${a.note ? `<span class="sub">${esc(a.note)}</span>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length, label: 'entries' })}`;
  }

  let timer;
  $('#a-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      s.q = e.target.value;
      s.page = 1;
      draw();
    }, 150);
  });
  for (const [id, key] of [['#a-user', 'user'], ['#a-action', 'action'], ['#a-entity', 'entity']]) {
    $(id).addEventListener('change', (e) => {
      s[key] = e.target.value;
      s.page = 1;
      draw();
    });
  }
  root.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      s.page = Number(pg.dataset.page);
      draw();
      return;
    }
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'clear') {
      Object.assign(s, { q: '', user: '', action: '', entity: '', page: 1 });
      $('#a-q').value = '';
      $('#a-user').value = '';
      $('#a-action').value = '';
      $('#a-entity').value = '';
      draw();
    }
    if (act === 'export') {
      const fmt = (v) => (v && typeof v === 'object' ? `${(v.cents / 100).toFixed(2)} ${v.currency}` : v ?? '');
      const data = rows.map((a) => [a.at, a.who, ROLE_LABELS[a.role], store.ACTION_LABELS[a.action], a.entityType, a.entityLabel, (a.changes || []).map((c) => `${c.field}: ${fmt(c.from)} -> ${fmt(c.to)}`).join('; '), a.note]);
      downloadFile(`ledgerly-audit-${todayISO()}.csv`, toCSV([['Timestamp', 'User', 'Role', 'Action', 'Entity type', 'Entity', 'Changes', 'Note'], ...data]));
      toast(`Exported ${plural(rows.length, 'audit entry', 'audit entries')} to CSV.`);
    }
  });
  draw();
  return { onStoreChange: draw };
}
