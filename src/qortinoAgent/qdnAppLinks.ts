/**
 * qortal:// links in Qortino's answers open in a Hub tab.
 */
import { executeEvent } from '../utils/events';
import { extractComponents } from '../components/Chat/MessageDisplay';
import { parkQortinoAgentSheet } from './qortinoSheetNav';

/** Open a full `qortal://…` link in a new Hub tab (APP paths supported). */
export function openQortalDeepLink(link: string): void {
  const url = link.trim().replace(/[.,;:!?)+]+$/, '');
  if (!url.toLowerCase().startsWith('qortal://')) return;
  parkQortinoAgentSheet();
  // extractComponents checks the link and returns the name already decoded;
  // decoding it again would turn "%252e%252e" into "%2e%2e".
  const res = extractComponents(url);
  if (!res) return;
  const name = res.name || '';
  executeEvent('addTab', {
    data: {
      service: res.service,
      name,
      identifier: res.identifier,
      path: res.path || '',
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}
