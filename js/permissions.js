// Role-based access control. The store calls `assertCan` before every mutation;
// the UI calls `can` / `denyReason` to hide or disable controls.

export const ROLE_LABELS = { owner: 'Owner', accountant: 'Accountant', viewer: 'Viewer' };

export const USERS = Object.freeze([
  { id: 'u_amna', name: 'Amna Siddiqui', role: 'owner', initials: 'AS' },
  { id: 'u_bilal', name: 'Bilal Ahmed', role: 'accountant', initials: 'BA' },
  { id: 'u_hira', name: 'Hira Malik', role: 'viewer', initials: 'HM' },
]);

const MATRIX = {
  'invoice.create': { roles: ['owner', 'accountant'], verb: 'create invoices' },
  'invoice.edit': { roles: ['owner', 'accountant'], verb: 'edit drafts' },
  'invoice.send': { roles: ['owner', 'accountant'], verb: 'send invoices' },
  'invoice.delete': { roles: ['owner'], verb: 'delete drafts' },
  'invoice.void': { roles: ['owner'], verb: 'void invoices' },
  'payment.record': { roles: ['owner', 'accountant'], verb: 'record payments' },
  'customer.create': { roles: ['owner', 'accountant'], verb: 'add customers' },
  'customer.edit': { roles: ['owner'], verb: 'edit customers' },
};

export class PermissionError extends Error {
  constructor(message, permission) {
    super(message);
    this.name = 'PermissionError';
    this.permission = permission;
  }
}

export function can(user, permission) {
  const rule = MATRIX[permission];
  if (!rule) throw new Error(`Unknown permission: ${permission}`);
  return !!user && rule.roles.includes(user.role);
}

function joinRoles(roles) {
  const labels = roles.map((r) => ROLE_LABELS[r] + 's');
  if (labels.length === 1) return `Only ${labels[0]}`;
  return `Only ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** Plain-language explanation, e.g. "Only Owners can void invoices. You're signed in as Accountant." */
export function denyReason(user, permission) {
  const rule = MATRIX[permission];
  return `${joinRoles(rule.roles)} can ${rule.verb}. You’re signed in as ${ROLE_LABELS[user?.role] ?? 'nobody'}.`;
}

export function assertCan(user, permission) {
  if (!can(user, permission)) throw new PermissionError(denyReason(user, permission), permission);
}

export function isReadOnly(user) {
  return user?.role === 'viewer';
}
