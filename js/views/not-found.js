import { esc } from '../format.js';
import { setTitle } from '../ui.js';

export function render(root, params = {}) {
  setTitle('Not found');
  const kind = params.kind;
  const title = kind === 'invoice' ? 'We couldn’t find that invoice' : kind === 'customer' ? 'We couldn’t find that customer' : 'This page doesn’t exist';
  const body = kind === 'invoice'
    ? `There’s no invoice <span class="mono">${esc(params.id)}</span>. It may have been a draft that was deleted, or the link has a typo.`
    : kind === 'customer'
      ? 'The customer may have been removed when the demo data was reset, or the link has a typo.'
      : `Nothing lives at <span class="mono">#${esc(params.path || '')}</span>. Check the link or head back to a page you know.`;
  root.innerHTML = `<div class="nf">
    <div class="code">404</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <div class="actions">
      <a class="btn btn-primary" href="#/dashboard">Go to dashboard</a>
      <a class="btn" href="${kind === 'customer' ? '#/customers' : '#/invoices'}">${kind === 'customer' ? 'View customers' : 'View invoices'}</a>
    </div></div>`;
  return {};
}
