// App shell + hash router. Each view module exports `render(root, params)` which
// draws into `root` and may return { canLeave(), onStoreChange(evt), destroy() }.
import * as store from './store.js';
import { ROLE_LABELS } from './permissions.js';
import { icon, toast, confirmDialog, setTitle } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as invoices from './views/invoices.js';
import * as invoiceDetail from './views/invoice-detail.js';
import * as editor from './views/invoice-editor.js';
import * as customers from './views/customers.js';
import * as customerDetail from './views/customer-detail.js';
import * as auditView from './views/audit.js';
import * as notFound from './views/not-found.js';

const ROUTES = [
  { re: /^\/?$/, redirect: '/dashboard' },
  { re: /^\/dashboard$/, view: dashboard, nav: 'dashboard' },
  { re: /^\/invoices$/, view: invoices, nav: 'invoices' },
  { re: /^\/invoices\/new$/, view: editor, nav: 'invoices', params: () => ({ mode: 'new' }) },
  { re: /^\/invoices\/([^/]+)\/edit$/, view: editor, nav: 'invoices', params: (m) => ({ mode: 'edit', id: decodeURIComponent(m[1]) }) },
  { re: /^\/invoices\/([^/]+)$/, view: invoiceDetail, nav: 'invoices', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { re: /^\/customers$/, view: customers, nav: 'customers' },
  { re: /^\/customers\/([^/]+)$/, view: customerDetail, nav: 'customers', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { re: /^\/audit$/, view: auditView, nav: 'audit' },
];

const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { id: 'invoices', label: 'Invoices', href: '#/invoices' },
  { id: 'customers', label: 'Customers', href: '#/customers' },
  { id: 'audit', label: 'Audit log', short: 'Audit', href: '#/audit' },
];

let current = null; // { path, handle, route }
let currentPath = null;
let suppressNext = false;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: new URLSearchParams(query) };
}

function renderNav(active) {
  const counts = { invoices: store.getInvoices().filter((i) => i.status === 'overdue').length };
  document.getElementById('side-nav').innerHTML = NAV.map((n) => `<a href="${n.href}" ${n.id === active ? 'aria-current="page"' : ''}>${icon(n.id)}<span>${n.label}</span>${n.id === 'invoices' && counts.invoices ? `<span class="nav-count" title="${counts.invoices} overdue">${counts.invoices} overdue</span>` : ''}</a>`).join('');
  document.getElementById('tab-nav').innerHTML = NAV.map((n) => `<a href="${n.href}" ${n.id === active ? 'aria-current="page"' : ''}>${icon(n.id)}<span>${n.short || n.label}</span></a>`).join('');
}

function renderUser() {
  const u = store.getCurrentUser();
  const sel = document.getElementById('user-select');
  sel.innerHTML = store.getUsers().map((x) => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${x.name} · ${ROLE_LABELS[x.role]}</option>`).join('');
  const av = document.getElementById('user-avatar');
  av.textContent = u.initials;
  av.dataset.role = u.role;
}

function route(force = false) {
  const { path, query } = parseHash();
  if (suppressNext) {
    suppressNext = false;
    return;
  }
  if (!force && current && current.path !== path && current.handle?.canLeave && !current.handle.canLeave()) {
    // Restore the previous URL, then ask.
    const target = location.hash;
    suppressNext = true;
    history.replaceState(null, '', '#' + currentPath);
    confirmDialog({
      title: 'Discard unsaved changes?',
      message: 'You have changes on this invoice that haven’t been saved. If you leave now, they’ll be lost.',
      confirmLabel: 'Discard changes',
    }).then((ok) => {
      if (ok) {
        current.handle.forceLeave?.();
        location.hash = target;
      }
    });
    setTimeout(() => (suppressNext = false), 0);
    return;
  }
  let match = null;
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      match = { r, m };
      break;
    }
  }
  if (match?.r.redirect) {
    history.replaceState(null, '', '#' + match.r.redirect);
    return route(true);
  }
  current?.handle?.destroy?.();
  // Each render gets a fresh host element so view-level listeners die with it.
  const main = document.getElementById('main');
  const root = document.createElement('div');
  main.replaceChildren(root);
  const view = match ? match.r.view : notFound;
  const params = match?.r.params ? match.r.params(match.m) : {};
  params.query = query;
  params.path = path;
  const samePage = currentPath === path;
  renderNav(match?.r.nav);
  let handle;
  try {
    handle = view.render(root, params) || {};
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="nf"><h1>This page couldn’t load</h1><p>${String(e.message || e)}</p><a class="btn" href="#/dashboard">Go to dashboard</a></div>`;
    handle = {};
  }
  current = { path, handle, view };
  currentPath = path;
  if (!samePage) {
    window.scrollTo(0, 0);
    const h1 = root.querySelector('h1');
    if (h1 && !root.querySelector('[autofocus]')) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }
}

function rerender() {
  if (!current) return;
  if (current.handle?.onStoreChange) {
    current.handle.onStoreChange();
    renderNav(ROUTES.find((r) => current.path.match(r.re))?.nav);
    return;
  }
  const y = window.scrollY;
  const active = document.activeElement?.id;
  route(true);
  window.scrollTo(0, y);
  if (active) document.getElementById(active)?.focus({ preventScroll: true });
}

function boot() {
  store.init();
  renderUser();
  document.getElementById('user-select').addEventListener('change', (e) => {
    store.setCurrentUser(e.target.value);
    renderUser();
    const u = store.getCurrentUser();
    toast(`Signed in as ${u.name} (${ROLE_LABELS[u.role]}).`, { timeout: 3500 });
  });
  document.addEventListener('click', async (e) => {
    const denied = e.target.closest('[aria-disabled="true"][data-denied]');
    if (denied) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toast(denied.dataset.denied, { error: true });
      return;
    }
    if (e.target.closest('[data-action="reset-demo"]')) {
      const ok = await confirmDialog({
        title: 'Reset demo data?',
        message: 'This replaces every invoice, customer, payment and audit entry in this browser with fresh demo data. Changes you made will be lost.',
        confirmLabel: 'Reset demo data',
      });
      if (ok) {
        current?.handle?.forceLeave?.();
        store.resetDemoData();
        toast('Demo data reset.');
        location.hash = '#/dashboard';
        route(true);
      }
    }
  }, true);
  store.subscribe(() => rerender());
  window.addEventListener('hashchange', () => route());
  window.addEventListener('beforeunload', (e) => {
    if (current?.handle?.canLeave && !current.handle.canLeave()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  if (!store.isPersistent()) toast('Your browser is blocking local storage, so changes will be lost when you close this tab.', { timeout: 10000 });
  route(true);
}

export function navigate(hash) {
  location.hash = hash;
}
export { setTitle };

boot();
