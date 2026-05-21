import DOMPurify from 'dompurify';

let openerPolicyHookInstalled = false;

function mergeRel(existing: string | null): string {
  const tokens = new Set<string>();
  if (existing) {
    for (const raw of existing.trim().split(/\s+/)) {
      if (raw) tokens.add(raw.toLowerCase());
    }
  }
  tokens.add('noopener');
  tokens.add('noreferrer');
  return [...tokens].join(' ');
}

/**
 * Links with target="_blank" must not receive window.opener in the new browsing context
 * (reverse tabnabbing). Applied to all DOMPurify.sanitize runs after this module loads.
 */
function installOpenerPolicyHook(): void {
  if (openerPolicyHookInstalled) return;
  openerPolicyHookInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    const target = node.getAttribute('target');
    if (target == null) return;
    if (target.replace(/\s+/g, '').toLowerCase() !== '_blank') return;
    node.setAttribute('rel', mergeRel(node.getAttribute('rel')));
  });
}

installOpenerPolicyHook();
