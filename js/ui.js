// Shared UI helpers: icons, badges, toasts, dialogs, permission-aware buttons, CSV.
import { esc, formatMoney, formatDate, formatDateTime } from './format.js';
import { STATUS_LABELS } from './invoice-math.js';
import { can, denyReason, ROLE_LABELS } from './permissions.js';
import * as store from './store.js';

const P = {
  dashboard: '<path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z"/>',
  invoices: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
  customers: '<path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
  audit: '<path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  print: '<path d="M7 9V3h10v6M7 18H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  filter: '<path d="M3 5h18l-7 9v6l-4-2v-4z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

export function badge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status]}</span>`;
}

export function money(cents, currency) {
  return `<span class="mono">${esc(formatMoney(cents, currency))}</span>`;
}

/**
 * A button that respects permissions. If the current user lacks `perm`, it is
 * rendered aria-disabled with a tooltip and an sr-only explanation (kept focusable
 * so keyboard users can discover why).
 */
export function permButton(perm, { label, cls = 'btn', action = '', attrs = '', iconName = '' }) {
  const user = store.getCurrentUser();
  const ic = iconName ? icon(iconName) : '';
  if (can(user, perm)) {
    return `<button type="button" class="${cls}" ${action ? `data-action="${action}"` : ''} ${attrs}>${ic}<span>${esc(label)}</span></button>`;
  }
  const reason = denyReason(user, perm);
  const id = `why-${Math.random().toString(36).slice(2, 8)}`;
  return `<button type="button" class="${cls}" aria-disabled="true" data-denied="${esc(reason)}" data-tip="${esc(reason)}" aria-describedby="${id}">${ic}<span>${esc(label)}</span></button><span id="${id}" class="sr-only">${esc(reason)}</span>`;
}

// ---------- toasts ----------
export function toast(message, { undo = null, error = false, timeout = 6000 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' is-error' : '');
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button" data-undo>Undo</button>' : ''}<button type="button" class="t-close" aria-label="Dismiss notification">×</button>`;
  const close = () => el.remove();
  el.querySelector('.t-close').addEventListener('click', close);
  if (undo) {
    el.querySelector('[data-undo]').addEventListener('click', () => {
      close();
      try {
        undo();
      } catch (e) {
        toast(errorMessage(e), { error: true });
      }
    });
  }
  host.appendChild(el);
  // Keep the stack short: older notifications make way for new ones.
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, undo ? Math.max(timeout, 8000) : timeout);
}

export function errorMessage(e) {
  if (e instanceof store.ValidationError) return Object.values(e.errors)[0] || e.message;
  return e?.message || 'Something went wrong. Reload the page and try again.';
}

// ---------- dialogs ----------
/**
 * Open a modal <dialog>. `body` is HTML; `onSubmit(form)` may throw a
 * ValidationError to show field errors. Resolves with the submit result or null.
 */
export function openDialog({ title, body, submitLabel, submitClass = 'btn btn-primary', cancelLabel = 'Cancel', wide = false, onSubmit, onOpen }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const dlg = document.createElement('dialog');
    if (wide) dlg.classList.add('wide');
    const tid = 'dlg-' + Math.random().toString(36).slice(2, 8);
    dlg.setAttribute('aria-labelledby', tid);
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h2 id="${tid}">${esc(title)}</h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close dialog">${icon('x')}</button></div>
      <div class="dlg-body">${body}</div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>${esc(cancelLabel)}</button><button type="submit" class="${submitClass}">${esc(submitLabel)}</button></div>
    </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let result = null;
    const finish = () => {
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', finish));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearErrors(form);
      try {
        result = onSubmit ? onSubmit(form) : true;
        if (result === false) {
          result = null;
          return;
        }
        finish();
      } catch (e) {
        result = null;
        if (e instanceof store.ValidationError) showErrors(form, e.errors);
        else showFormError(form, errorMessage(e));
      }
    });
    dlg.showModal();
    onOpen?.(dlg);
    const first = dlg.querySelector('[autofocus]') || dlg.querySelector('input, select, textarea') || dlg.querySelector('button[type="submit"]');
    first?.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel, danger = true, extraBody = '', onConfirm }) {
  return openDialog({
    title,
    body: `<p class="lead">${message}</p>${extraBody}`,
    submitLabel: confirmLabel,
    submitClass: danger ? 'btn btn-danger' : 'btn btn-primary',
    onSubmit: onConfirm || (() => true),
  });
}

function showFormError(form, msg) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'err form-error';
    box.setAttribute('role', 'alert');
    form.querySelector('.dlg-body')?.prepend(box);
  }
  box.textContent = msg;
}

export function clearErrors(root) {
  root.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  root.querySelectorAll('.err[data-for], .form-error').forEach((el) => (el.textContent = ''));
}

/** Show field errors keyed by input name; focus the first invalid field in DOM order. */
export function showErrors(root, errors) {
  let first = null;
  for (const [key, msg] of Object.entries(errors)) {
    const input = root.querySelector(`[name="${CSS.escape(key)}"]`);
    const slot = root.querySelector(`.err[data-for="${CSS.escape(key)}"]`);
    if (slot) slot.textContent = msg;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (slot?.id) input.setAttribute('aria-describedby', slot.id);
    }
    if (!slot && !input) showFormError(root, msg);
  }
  const all = [...root.querySelectorAll('[aria-invalid="true"]')];
  first = all[0];
  if (first) first.focus();
  return first;
}

export function errSlot(name) {
  const id = 'err-' + name.replace(/[^a-z0-9]/gi, '-');
  return `<p class="err" data-for="${esc(name)}" id="${id}" aria-live="polite"></p>`;
}

// ---------- CSV ----------
export function toCSV(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function downloadFile(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- audit rendering ----------
function renderValue(v) {
  if (v && typeof v === 'object' && 'cents' in v) return esc(formatMoney(v.cents, v.currency));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return esc(formatDate(v));
  return esc(v);
}
export function renderChanges(changes) {
  return (changes || [])
    .map((c) => {
      if (c.from === '' || c.from == null) return `<span class="change">${esc(c.field)}: ${renderValue(c.to)}</span>`;
      if (c.to === '' || c.to == null) return `<span class="change">${esc(c.field)}: <span class="from">${renderValue(c.from)}</span> removed</span>`;
      return `<span class="change">${esc(c.field)}: <span class="from">${renderValue(c.from)}</span><span class="arrow" aria-label="changed to">→</span>${renderValue(c.to)}</span>`;
    })
    .join('<br>');
}

export function renderTimeline(entries) {
  if (!entries.length) return '<p class="muted small" style="padding:12px 18px">No activity yet.</p>';
  return `<ol class="timeline">${[...entries]
    .reverse()
    .map((a) => {
      const kind = a.action.split('.')[1] || '';
      return `<li class="t-${esc(kind)}"><div class="t-what">${esc(store.ACTION_LABELS[a.action] || a.action)}</div>
        <div class="t-meta">${esc(a.who)} · ${esc(ROLE_LABELS[a.role])} · <time datetime="${esc(a.at)}">${esc(formatDateTime(a.at))}</time></div>
        ${a.changes?.length ? `<div class="t-change">${renderChanges(a.changes)}</div>` : ''}
        ${a.note ? `<div class="t-note">${esc(a.note)}</div>` : ''}</li>`;
    })
    .join('')}</ol>`;
}

export function setTitle(t) {
  document.title = t ? `${t} · Ledgerly` : 'Ledgerly';
}

/** Sortable column header: a button inside a th with aria-sort. */
export function sortHeader(key, label, sort, { num = false, cls = '' } = {}) {
  const active = (sort.key ?? sort.sort) === key;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null;
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  return `<th scope="col" class="${num ? 'num' : ''} ${cls}" ${ariaSort ? `aria-sort="${ariaSort}"` : ''}><button type="button" class="sort-btn" data-sort="${key}">${esc(label)}<span class="arrow" aria-hidden="true">${arrow}</span></button></th>`;
}

export function pager({ page, pageSize, total, label = 'invoices' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  let btns = '';
  for (let p = 1; p <= pages; p++) {
    if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - page) > 1) {
      if (p === 2 || p === pages - 1) btns += '<span aria-hidden="true">…</span>';
      continue;
    }
    btns += `<button type="button" class="btn btn-sm" data-page="${p}" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`;
  }
  return `<nav class="pager" aria-label="Pagination">
    <span>Showing <span class="mono">${from}–${to}</span> of <span class="mono">${total}</span> ${esc(label)}</span>
    <div class="pages">
      <button type="button" class="btn btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      ${btns}
      <button type="button" class="btn btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div></nav>`;
}
