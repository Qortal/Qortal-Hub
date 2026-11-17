/**
 * qortal:// links in Qortino's answers open in a Hub tab.
 */
import { executeEvent } from '../utils/events';
import { openQortalUseGroupLink } from '../utils/openQortalUseGroupLink';
import { extractComponents } from '../components/Chat/MessageDisplay';
import { parkQortinoAgentSheet } from './qortinoSheetNav';

/** Open a full `qortal://…` link in a new Hub tab (APP paths supported). */
export function openQortalDeepLink(link: string): void {
  // A plus at the end is part of the name ("POS+", "Q-Share+").
  const url = link.trim().replace(/[.,;:!?)]+$/, '');
  if (!url.toLowerCase().startsWith('qortal://')) return;
  // A payment link (qortal://pay?…, qortal://send) is not a website named
  // "pay": Hub doesn't open payment links, so nothing opens.
  if (/^qortal:\/\/(pay|send)(?=$|[?#/])/i.test(url)) return;
  parkQortinoAgentSheet();
  // extractComponents checks the link and returns the name already decoded;
  // decoding it again would turn "%252e%252e" into "%2e%2e".
  const res = extractComponents(url);
  if (!res) {
    // A group link (qortal://use-group/…) opens as it does in a chat.
    void openQortalUseGroupLink(url);
    return;
  }
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
