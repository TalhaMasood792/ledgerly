import * as store from '../store.js';
import { esc, formatMoney, formatMoneyCompact, formatMonth, formatMonthYear, formatDate, FX_RATES_TO_USD, BASE_CURRENCY, plural } from '../format.js';
import { setTitle, permButton, icon } from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function niceMax(v) {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function barChart(months, currentKey, W = 720) {
  const narrow = W < 520;
  const H = narrow ? 220 : 260, padL = narrow ? 40 : 52, padR = 4, padT = 12, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(...months.map((m) => Math.max(m.invoiced, m.collected))) / 100) * 100;
  const ticks = 4;
  const band = plotW / months.length;
  const barW = Math.max(3, Math.min(18, (band - (narrow ? 4 : 10)) / 2));
  const y = (v) => padT + plotH - (v / max) * plotH;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title chart-desc" xmlns="${SVG_NS}">`;
  s += `<title id="chart-title">Invoiced vs collected, last 12 months</title><desc id="chart-desc">Bar chart in US dollars. A data table follows the chart.</desc>`;
  s += '<g class="axis" aria-hidden="true">';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const yy = y(v);
    s += `<line class="${i === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    s += `<text class="ytext" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${esc(formatMoneyCompact(v, 'USD'))}</text>`;
  }
  s += '</g>';
  const r = 3;
  // Bar rounded at the top only, anchored to baseline.
  const bar = (x, v, cls) => {
    if (v <= 0) return '';
    const top = y(v), bottom = y(0), h = bottom - top;
    const rr = Math.min(r, h);
    return `<path class="${cls}" d="M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${bottom} Z"/>`;
  };
  months.forEach((m, i) => {
    const cx = padL + band * i + band / 2;
    const x1 = cx - barW - 1, x2 = cx + 1;
    s += `<g class="col ${m.key === currentKey ? 'is-current' : ''}" data-i="${i}">`;
    s += `<rect class="hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH}" rx="4"/>`;
    s += bar(x1, m.invoiced, 'bar-a') + bar(x2, m.collected, 'bar-b');
    const lab = narrow ? formatMonth(m.key).slice(0, 1) : formatMonth(m.key).slice(0, 3);
    s += `<text class="xlab" x="${cx}" y="${H - 8}" text-anchor="middle" aria-hidden="true">${esc(lab)}</text></g>`;
  });
  s += '</svg>';
  return s;
}

export function render(root) {
  setTitle('Dashboard');
  const d = store.dashboardMetrics();
  const user = store.getCurrentUser();
  const currentKey = d.today.slice(0, 7);
  const delta = d.collectedThisMonth - d.collectedSamePointLastMonth;
  const agingTotal = d.buckets.reduce((s, b) => s + b.amount, 0);
  const agingColor = { current: 'var(--accent)', '1-30': 'var(--warning)', '31-60': 'var(--warning)', '61-90': 'var(--danger)', '90+': 'var(--danger)' };
  const fxNote = Object.entries(FX_RATES_TO_USD).filter(([c]) => c !== 'USD').map(([c, r]) => `1 ${c} = ${r} USD`).join(' · ');
  const firstName = user.name.split(' ')[0];

  root.innerHTML = `
  <div class="page-head">
    <div>
      <h1>Receivables overview</h1>
      <p class="sub">Good to see you, ${esc(firstName)}. Figures as of ${esc(formatDate(d.today))}, in ${BASE_CURRENCY}.</p>
    </div>
    <div class="page-actions">
      <a class="btn" href="#/invoices?status=overdue">View overdue</a>
      ${permButton('invoice.create', { label: 'New invoice', cls: 'btn btn-primary', action: 'new-invoice', iconName: 'plus' })}
    </div>
  </div>

  <section class="kpis" aria-label="Key figures">
    <div class="card kpi">
      <div class="kpi-label">Outstanding receivables</div>
      <div class="kpi-value" data-kpi="outstanding">${esc(formatMoney(d.outstanding, 'USD'))}</div>
      <div class="kpi-foot">${plural(d.openCount, 'open invoice')}</div>
    </div>
    <div class="card kpi ${d.overdue > 0 ? 'is-alert' : ''}">
      <div class="kpi-label">Overdue</div>
      <div class="kpi-value" data-kpi="overdue">${esc(formatMoney(d.overdue, 'USD'))}</div>
      <div class="kpi-foot"><a href="#/invoices?status=overdue">${plural(d.overdueCount, 'invoice')} past due</a></div>
    </div>
    <div class="card kpi">
      <div class="kpi-label">Collected this month</div>
      <div class="kpi-value" data-kpi="collected">${esc(formatMoney(d.collectedThisMonth, 'USD'))}</div>
      <div class="kpi-foot">${delta >= 0 ? '+' : '−'}${esc(formatMoney(Math.abs(delta), 'USD'))} vs same point last month</div>
    </div>
    <div class="card kpi">
      <div class="kpi-label"><span>Days sales outstanding</span></div>
      <div class="kpi-value" data-kpi="dso">${d.dso == null ? '—' : `${d.dso}<span class="unit">days</span>`}</div>
      <div class="kpi-foot">Receivables ÷ last ${d.dsoDays} days’ invoicing × ${d.dsoDays}</div>
    </div>
  </section>

  <div class="dash-grid">
    <section class="card" aria-labelledby="h-chart">
      <div class="card-head">
        <div><h2 id="h-chart">Invoiced vs collected</h2><p class="meta">Last 12 months, ${BASE_CURRENCY}</p></div>
        <div class="legend" aria-hidden="true"><span><span class="sw" style="background:var(--chart-a)"></span>Invoiced</span><span><span class="sw" style="background:var(--chart-b)"></span>Collected</span></div>
      </div>
      <div class="chart-wrap" id="chart"><div id="chart-svg"></div><div class="tooltip" id="chart-tip" hidden></div></div>
      <details class="table-alt">
        <summary>Show chart data as a table</summary>
        <div class="tbl-scroll"><table class="tbl">
          <caption class="sr-only">Invoiced and collected amounts by month, USD</caption>
          <thead><tr><th scope="col">Month</th><th scope="col" class="num">Invoiced</th><th scope="col" class="num">Collected</th></tr></thead>
          <tbody>${d.months.map((m) => `<tr><th scope="row" style="font-weight:400;background:none;color:var(--ink)">${esc(formatMonthYear(m.key))}</th><td class="num mono">${esc(formatMoney(m.invoiced, 'USD'))}</td><td class="num mono">${esc(formatMoney(m.collected, 'USD'))}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </section>

    <section class="card" aria-labelledby="h-aging">
      <div class="card-head"><div><h2 id="h-aging">Receivables aging</h2><p class="meta">Open balances by days past due</p></div></div>
      <ul class="aging">
        ${d.buckets.map((b) => {
          const pct = agingTotal ? (b.amount / agingTotal) * 100 : 0;
          return `<li>
            <span class="a-label">${esc(b.label)}<span class="a-count">${plural(b.count, 'invoice')}</span></span>
            <span class="a-track" role="img" aria-label="${esc(b.label)}: ${pct.toFixed(0)}% of open receivables"><span class="a-bar" style="width:${b.amount ? Math.max(pct, 1).toFixed(2) : 0}%;background:${agingColor[b.id]}"></span></span>
            <span class="a-amt">${esc(formatMoney(b.amount, 'USD'))}<span class="a-pct">${pct.toFixed(0)}%</span></span>
          </li>`;
        }).join('')}
      </ul>
      <div class="aging-total"><span class="muted">Total open</span><span class="mono">${esc(formatMoney(agingTotal, 'USD'))}</span></div>
    </section>

    <section class="card span-2" aria-labelledby="h-attn">
      <div class="card-head">
        <div><h2 id="h-attn">Needs attention</h2><p class="meta">Most overdue invoices first</p></div>
        <a class="btn btn-sm" href="#/invoices?status=overdue&sort=due&dir=asc">All overdue invoices</a>
      </div>
      ${d.attention.length ? `<ul class="attn">${d.attention.map((i) => `<li><a href="#/invoices/${encodeURIComponent(i.id)}">
          <span class="t1">${esc(i.customerName)}</span>
          <span class="amt">${esc(formatMoney(i.balance, i.currency))}</span>
          <span class="t2"><span class="mono">${esc(i.number)}</span> · due ${esc(formatDate(i.dueDate))}${i.paid ? ' · partially paid' : ''}</span>
          <span class="late">${i.daysOverdue} days overdue</span>
        </a></li>`).join('')}</ul>` : `<div class="empty"><h2>Nothing overdue</h2><p>Every sent invoice is within its payment terms.</p></div>`}
    </section>
  </div>
  <p class="fx-note">Amounts in other currencies are converted to ${BASE_CURRENCY} at fixed demo rates: ${esc(fxNote)}.</p>`;

  root.querySelector('[data-action="new-invoice"]')?.addEventListener('click', () => (location.hash = '#/invoices/new'));

  // Chart is drawn at the container's pixel width so text stays legible at any size.
  const wrap = root.querySelector('#chart');
  const tip = root.querySelector('#chart-tip');
  const host = root.querySelector('#chart-svg');
  let lastW = 0;
  const show = (g) => {
    const m = d.months[Number(g.dataset.i)];
    wrap.querySelectorAll('.hit.is-active').forEach((h) => h.classList.remove('is-active'));
    g.querySelector('.hit').classList.add('is-active');
    const sw = (v) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${v};margin-right:6px"></span>`;
    tip.innerHTML = `<div class="tt-title">${esc(formatMonthYear(m.key))}</div>
      <div class="tt-row"><span>${sw('var(--chart-a)')}Invoiced</span><span class="num">${esc(formatMoney(m.invoiced, 'USD'))}</span></div>
      <div class="tt-row"><span>${sw('var(--chart-b)')}Collected</span><span class="num">${esc(formatMoney(m.collected, 'USD'))}</span></div>`;
    tip.hidden = false;
    const hit = g.querySelector('.hit').getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const centre = hit.left - box.left + hit.width / 2;
    // Sit beside the hovered column so the tooltip never covers its own bars.
    let left = centre + hit.width / 2 + 6;
    if (left + tw > box.width - 4) left = centre - hit.width / 2 - tw - 6;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = '12px';
  };
  const hide = () => {
    tip.hidden = true;
    wrap.querySelectorAll('.hit.is-active').forEach((h) => h.classList.remove('is-active'));
  };
  function drawChart() {
    const w = Math.round(host.clientWidth || 720);
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    host.innerHTML = barChart(d.months, currentKey, w);
    host.querySelectorAll('g.col').forEach((g) => {
      g.addEventListener('mouseenter', () => show(g));
      g.addEventListener('mouseleave', hide);
      g.addEventListener('click', () => show(g)); // tap support
    });
  }
  drawChart();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawChart()) : null;
  ro?.observe(host);
  return { destroy: () => ro?.disconnect() };
}
