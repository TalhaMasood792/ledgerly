// Deterministic demo data. Every date is relative to `today`, so the demo always
// looks current; the PRNG seed is fixed, so the same day always produces the same data.
import { addDays, daysBetween, FX_RATES_TO_USD } from './format.js';
import { computeTotals, dueDateFor, termsLabel } from './invoice-math.js';
import { USERS } from './permissions.js';

export const SEED = 20261009;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [AMNA, BILAL] = USERS;

// payDelay: typical days paid relative to due date (negative = early). weight: how often invoiced.
const CUSTOMERS = [
  { id: 'c_indus', name: 'Indus Logistics (Pvt) Ltd', contactName: 'Faraz Qureshi', email: 'accounts@induslogistics.pk', phone: '+92 21 3567 1180', line1: 'Plot 14, Sector 23, Korangi Industrial Area', city: 'Karachi', region: 'Sindh', postal: '74900', country: 'Pakistan', currency: 'PKR', taxRate: 16, terms: 'net30', taxId: 'NTN 4218837-6', payDelay: 6, weight: 6 },
  { id: 'c_margalla', name: 'Margalla Software House', contactName: 'Sana Javed', email: 'finance@margallasoft.com', phone: '+92 51 2830 4471', line1: 'Office 9, Blue Area, Jinnah Avenue', city: 'Islamabad', region: 'ICT', postal: '44000', country: 'Pakistan', currency: 'PKR', taxRate: 16, terms: 'net15', taxId: 'NTN 7730164-2', payDelay: 2, weight: 5 },
  { id: 'c_ravi', name: 'Ravi Textiles Ltd', contactName: 'Usman Tariq', email: 'payables@ravitextiles.com.pk', phone: '+92 41 8712 0093', line1: '22-km Sheikhupura Road', city: 'Faisalabad', region: 'Punjab', postal: '38000', country: 'Pakistan', currency: 'PKR', taxRate: 16, terms: 'net60', taxId: 'NTN 1093382-1', payDelay: 45, weight: 4 },
  { id: 'c_kohistan', name: 'Kohistan Foods', contactName: 'Ayesha Rauf', email: 'ayesha.rauf@kohistanfoods.pk', phone: '+92 42 3575 2210', line1: '41-C, Main Boulevard, Gulberg III', city: 'Lahore', region: 'Punjab', postal: '54660', country: 'Pakistan', currency: 'PKR', taxRate: 16, terms: 'net30', taxId: 'NTN 5527719-4', payDelay: 10, weight: 3 },
  { id: 'c_alnoor', name: 'Al Noor Trading LLC', contactName: 'Omar Haddad', email: 'ap@alnoortrading.ae', phone: '+971 4 339 2051', line1: 'Office 1204, Al Moosa Tower 2, Sheikh Zayed Road', city: 'Dubai', region: 'Dubai', postal: '', country: 'United Arab Emirates', currency: 'USD', taxRate: 0, terms: 'net30', taxId: 'TRN 100384729100003', payDelay: 12, weight: 5 },
  { id: 'c_gulfhorizon', name: 'Gulf Horizon Properties', contactName: 'Rania Khalil', email: 'rania.khalil@gulfhorizon.ae', phone: '+971 2 645 7781', line1: 'Level 18, Addax Tower, Al Reem Island', city: 'Abu Dhabi', region: 'Abu Dhabi', postal: '', country: 'United Arab Emirates', currency: 'USD', taxRate: 0, terms: 'net60', taxId: 'TRN 100592018300003', payDelay: 20, weight: 4 },
  { id: 'c_creekside', name: 'Creekside Hospitality FZ-LLC', contactName: 'Daniel Mathew', email: 'accounts@creeksidehospitality.com', phone: '+971 4 422 9036', line1: 'Building 7, Dubai Design District', city: 'Dubai', region: 'Dubai', postal: '', country: 'United Arab Emirates', currency: 'USD', taxRate: 0, terms: 'net30', taxId: 'TRN 100211874600003', payDelay: 3, weight: 3 },
  { id: 'c_thameslink', name: 'Thameslink Analytics Ltd', contactName: 'Charlotte Evans', email: 'accounts.payable@thameslink-analytics.co.uk', phone: '+44 20 7946 0321', line1: '3rd Floor, 88 Clerkenwell Road', city: 'London', region: '', postal: 'EC1M 5RJ', country: 'United Kingdom', currency: 'GBP', taxRate: 20, terms: 'net30', taxId: 'VAT GB 284 1937 06', payDelay: 0, weight: 6 },
  { id: 'c_pennine', name: 'Pennine Outdoor Co.', contactName: 'James Whitaker', email: 'james@pennineoutdoor.co.uk', phone: '+44 113 496 0752', line1: 'Unit 5, Kirkstall Forge', city: 'Leeds', region: 'West Yorkshire', postal: 'LS5 3BF', country: 'United Kingdom', currency: 'GBP', taxRate: 20, terms: 'net30', taxId: 'VAT GB 611 4820 33', payDelay: 38, weight: 4 },
  { id: 'c_harbour', name: 'Harbour & Finch LLP', contactName: 'Priya Shah', email: 'priya.shah@harbourfinch.co.uk', phone: '+44 117 496 0418', line1: '12 Queen Square', city: 'Bristol', region: '', postal: 'BS1 4NT', country: 'United Kingdom', currency: 'GBP', taxRate: 20, terms: 'net15', taxId: 'VAT GB 937 2264 18', payDelay: 4, weight: 3 },
  { id: 'c_cascade', name: 'Cascade Health Partners', contactName: 'Megan Liu', email: 'ap@cascadehealth.com', phone: '+1 206 555 0147', line1: '1420 5th Avenue, Suite 2200', city: 'Seattle', region: 'WA', postal: '98101', country: 'United States', currency: 'USD', taxRate: 0, terms: 'net30', taxId: 'EIN 91-2748310', payDelay: 8, weight: 6 },
  { id: 'c_brightline', name: 'Brightline Robotics Inc.', contactName: 'Marcus Reed', email: 'billing@brightlinerobotics.com', phone: '+1 512 555 0193', line1: '600 Congress Avenue, Floor 14', city: 'Austin', region: 'TX', postal: '78701', country: 'United States', currency: 'USD', taxRate: 0, terms: 'net15', taxId: 'EIN 47-3301926', payDelay: 1, weight: 5 },
  { id: 'c_ferrous', name: 'Ferrous Capital LLC', contactName: 'Elena Petrova', email: 'elena.petrova@ferrouscap.com', phone: '+1 212 555 0168', line1: '250 Park Avenue South, 7th Floor', city: 'New York', region: 'NY', postal: '10003', country: 'United States', currency: 'USD', taxRate: 0, terms: 'net30', taxId: 'EIN 82-1190457', payDelay: 15, weight: 4 },
  { id: 'c_vandijk', name: 'Van Dijk Mobility B.V.', contactName: 'Joris van Dijk', email: 'facturen@vandijkmobility.nl', phone: '+31 20 794 3315', line1: 'Keizersgracht 482', city: 'Amsterdam', region: 'North Holland', postal: '1017 EG', country: 'Netherlands', currency: 'EUR', taxRate: 0, terms: 'net60', taxId: 'VAT NL 8573.21.904.B01', payDelay: 5, weight: 4 },
];

// Prices in USD cents; converted into the customer's currency and rounded to a tidy figure.
const CATALOG = [
  { d: 'Brand identity system — discovery, logo suite and guidelines', p: 480000, q: [1, 1] },
  { d: 'UX research sprint (per week)', p: 320000, q: [1, 3] },
  { d: 'Product design (per day)', p: 72000, q: [3, 12] },
  { d: 'Front-end development (per day)', p: 68000, q: [4, 15] },
  { d: 'Design system audit and recommendations', p: 240000, q: [1, 1] },
  { d: 'Website care retainer (monthly)', p: 150000, q: [1, 1] },
  { d: 'Moderated usability testing session', p: 45000, q: [4, 10] },
  { d: 'Editorial illustration set (6 pieces)', p: 180000, q: [1, 2] },
  { d: 'Motion design (per hour)', p: 9500, q: [8, 36] },
  { d: 'UX copywriting (per screen)', p: 6000, q: [10, 40] },
  { d: 'Hosting and uptime monitoring (monthly)', p: 12000, q: [1, 1] },
  { d: 'Stakeholder workshop facilitation', p: 125000, q: [1, 2] },
  { d: 'Accessibility review (WCAG 2.2 AA)', p: 210000, q: [1, 1] },
];

function priceIn(usdCents, currency) {
  const raw = usdCents / FX_RATES_TO_USD[currency];
  const step = currency === 'PKR' ? 100000 : currency === 'USD' ? 500 : 500; // PKR 1,000 or 5.00
  return Math.max(step, Math.round(raw / step) * step);
}

function stamp(date, rng, startHour = 9, span = 8) {
  const h = startHour + Math.floor(rng() * span);
  const m = Math.floor(rng() * 60);
  const s = Math.floor(rng() * 60);
  return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function buildSeed(today) {
  const rng = mulberry32(SEED);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const between = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const audit = [];
  let auditSeq = 0;
  const log = (at, user, action, entityType, entityId, entityLabel, changes = [], note = '') =>
    audit.push({ id: `a_${String(++auditSeq).padStart(5, '0')}`, at, userId: user.id, who: user.name, role: user.role, action, entityType, entityId, entityLabel, changes, note });

  const customers = CUSTOMERS.map((c, i) => {
    const createdOn = addDays(today, -400 + i * 2);
    const createdAt = stamp(createdOn, rng);
    const { payDelay, weight, line1, city, region, postal, country, ...rest } = c;
    const cust = { ...rest, address: { line1, line2: '', city, region, postal, country }, createdAt, notes: '' };
    log(createdAt, AMNA, 'customer.created', 'customer', c.id, c.name, [], `Added ${c.name} (${c.currency}, ${termsLabel(c.terms)}).`);
    return cust;
  });
  const meta = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]));
  const weighted = CUSTOMERS.flatMap((c) => Array(c.weight).fill(c.id));

  // A couple of realistic customer edits.
  log(stamp(addDays(today, -210), rng), AMNA, 'customer.updated', 'customer', 'c_pennine', 'Pennine Outdoor Co.', [{ field: 'Contact email', from: 'accounts@pennineoutdoor.co.uk', to: 'james@pennineoutdoor.co.uk' }]);
  log(stamp(addDays(today, -95), rng), AMNA, 'customer.updated', 'customer', 'c_gulfhorizon', 'Gulf Horizon Properties', [{ field: 'Payment terms', from: 'Net 30', to: 'Net 60' }]);

  const N = 70;
  const issueDates = [];
  for (let i = 0; i < N; i++) {
    const base = Math.round(362 * Math.pow(1 - i / (N - 1), 1.25));
    issueDates.push(Math.max(0, Math.min(364, base + between(-2, 2))));
  }
  issueDates.sort((a, b) => b - a); // days ago, oldest first

  const DRAFTS = new Set([N - 1, N - 2, N - 4]);
  const VOIDS = new Map([[21, 'Raised against the wrong purchase order; reissued with the correct PO.'], [48, 'Project phase cancelled by the client before work began.']]);
  const LONG_OVERDUE = new Set([28, 31, 34]); // ~150–200 days ago, left unpaid
  const LONG_OVERDUE_CUSTOMERS = ['c_ravi', 'c_pennine', 'c_ferrous'];

  const seq = {};
  let notDueSeen = 0;
  const invoices = [];
  for (let i = 0; i < N; i++) {
    const issueDate = addDays(today, -issueDates[i]);
    let customerId = pick(weighted);
    if (LONG_OVERDUE.has(i)) customerId = LONG_OVERDUE_CUSTOMERS[[...LONG_OVERDUE].indexOf(i)];
    const c = meta[customerId];
    const year = issueDate.slice(0, 4);
    seq[year] = (seq[year] || 0) + 1;
    const number = `INV-${year}-${String(seq[year]).padStart(4, '0')}`;
    const terms = c.terms;
    const dueDate = dueDateFor(issueDate, terms);

    const lineCount = between(1, 4);
    const used = new Set();
    const lines = [];
    for (let l = 0; l < lineCount; l++) {
      let item;
      do item = pick(CATALOG); while (used.has(item.d));
      used.add(item.d);
      const qty = between(item.q[0], item.q[1]);
      const discount = rng() < 0.15 ? pick([5, 10]) : 0;
      lines.push({ id: `${number}-L${l + 1}`, description: item.d, qty, unitPrice: priceIn(item.p, c.currency), taxRate: c.taxRate, discount });
    }
    const po = rng() < 0.6 ? `PO ${between(4500, 4599)}-${between(1000, 9999)}` : '';
    const inv = {
      id: number, number, customerId, currency: c.currency, issueDate, terms, dueDate,
      status: 'sent', lines, payments: [],
      notes: po ? `Please quote ${po} on your remittance.` : 'Thank you for your business.',
      reference: po, createdAt: '', updatedAt: '', sentAt: null, voidedAt: null, voidReason: '',
    };
    const creator = rng() < 0.7 ? BILAL : AMNA;
    const createdOn = DRAFTS.has(i) ? issueDate : addDays(issueDate, -between(0, 2));
    inv.createdAt = stamp(createdOn > today ? today : createdOn, rng, 9, 3);
    const total = computeTotals(lines).total;
    log(inv.createdAt, creator, 'invoice.created', 'invoice', number, number, [{ field: 'Total', from: '', to: { cents: total, currency: c.currency } }], `Draft for ${c.name}`);
    inv.updatedAt = inv.createdAt;

    if (DRAFTS.has(i)) {
      inv.status = 'draft';
      invoices.push(inv);
      continue;
    }
    inv.sentAt = stamp(issueDate, rng, 13, 4);
    if (inv.sentAt < inv.createdAt) inv.sentAt = inv.createdAt.replace(/T(\d\d)/, (m, h) => `T${String(Math.min(23, +h + 1)).padStart(2, '0')}`);
    log(inv.sentAt, creator, 'invoice.sent', 'invoice', number, number, [{ field: 'Status', from: 'Draft', to: 'Sent' }], `Emailed to ${c.email}.`);
    inv.updatedAt = inv.sentAt;

    if (VOIDS.has(i)) {
      inv.status = 'void';
      inv.voidReason = VOIDS.get(i);
      inv.voidedAt = stamp(addDays(issueDate, between(2, 6)), rng);
      log(inv.voidedAt, AMNA, 'invoice.voided', 'invoice', number, number, [{ field: 'Status', from: 'Sent', to: 'Void' }], inv.voidReason);
      inv.updatedAt = inv.voidedAt;
      invoices.push(inv);
      continue;
    }

    const method = () => (c.country === 'United States' ? pick(['Card', 'Bank transfer', 'Bank transfer']) : c.country === 'Pakistan' ? pick(['Bank transfer', 'Bank transfer', 'Cheque']) : 'Bank transfer');
    const ref = (m) => (m === 'Cheque' ? `CHQ ${between(100000, 999999)}` : m === 'Card' ? `ch_${Math.floor(rng() * 1e10).toString(36)}` : `TRF${between(10000000, 99999999)}`);
    const addPayment = (date, amount) => {
      const m = method();
      const p = { id: `${number}-P${inv.payments.length + 1}`, date, amount, method: m, reference: ref(m), recordedBy: BILAL.id };
      const before = total - inv.payments.reduce((s, x) => s + x.amount, 0);
      inv.payments.push(p);
      const at = stamp(date, rng, 10, 7);
      log(at, rng() < 0.8 ? BILAL : AMNA, 'payment.recorded', 'invoice', number, number,
        [{ field: 'Balance due', from: { cents: before, currency: c.currency }, to: { cents: before - amount, currency: c.currency } }],
        `${m} payment ${p.reference}.`);
      inv.updatedAt = at;
    };

    if (LONG_OVERDUE.has(i)) {
      if (i === 31) addPayment(addDays(dueDate, 12), Math.round(total * 0.4));
      invoices.push(inv);
      continue;
    }
    // Recently due invoices are often still open: a realistic slice of 1–75 day arrears.
    const pastDue = daysBetween(dueDate, today);
    if (pastDue <= 0) {
      // Not yet due; every third customer pays a deposit up front.
      notDueSeen++;
      const d = addDays(issueDate, between(1, 6));
      if (notDueSeen % 3 === 1 && d <= today) addPayment(d, Math.round(total * pick([0.3, 0.5])));
      invoices.push(inv);
      continue;
    }
    if (pastDue > 0 && pastDue <= 75 && rng() < 0.42) {
      if (rng() < 0.45) {
        let d = addDays(dueDate, -between(0, 10));
        if (d < issueDate) d = issueDate;
        addPayment(d, Math.round(total * pick([0.25, 0.4, 0.5])));
      }
      invoices.push(inv);
      continue;
    }
    const payDate = addDays(dueDate, c.payDelay + between(-6, 10));
    const split = rng() < 0.22;
    if (split) {
      const first = Math.round(total * pick([0.3, 0.4, 0.5]));
      const firstDate = addDays(issueDate, between(5, Math.max(6, daysBetween(issueDate, payDate) - 3)));
      if (firstDate <= today) addPayment(firstDate, first);
      if (payDate <= today && payDate > firstDate) addPayment(payDate, total - first);
    } else if (payDate <= today) {
      addPayment(payDate < issueDate ? issueDate : payDate, total);
    }
    invoices.push(inv);
  }

  audit.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  audit.forEach((a, idx) => (a.id = `a_${String(idx + 1).padStart(5, '0')}`));
  return { version: 1, seededOn: today, customers, invoices, audit, sequences: seq, auditSeq: audit.length };
}
