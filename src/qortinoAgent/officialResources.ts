/**
 * Curated Qortal guides / official pages Qortino can recommend, shown as
 * tappable links under an answer (new app tab / new browser tab).
 */
import { executeEvent } from '../utils/events';
import { parkQortinoAgentSheet } from './qortinoSheetNav';

export type OfficialResourceLink = {
  id: string;
  label: string;
  /** Short why this link is offered */
  blurb?: string;
  service?: 'APP' | 'WEBSITE';
  name?: string;
  /** External https page */
  href?: string;
};

export const OFFICIAL_QDN_GUIDES: OfficialResourceLink[] = [
  {
    id: 'welcome',
    label: 'Welcome to Qortal',
    blurb: 'Newcomer orientation on QDN',
    service: 'APP',
    name: 'Welcome to Qortal',
  },
  {
    id: 'q-minter-guide',
    label: 'Q-Minter Guide',
    blurb: 'Detailed minting guide',
    service: 'WEBSITE',
    name: 'Q-Minter',
  },
  {
    id: 'q-mintership',
    label: 'Q-Mintership',
    blurb: 'Nominations & Minter Admin board',
    service: 'APP',
    name: 'Q-Mintership',
  },
];

const OFFICIAL_WEB_LINKS: OfficialResourceLink[] = [
  {
    id: 'dev-minting',
    label: 'qortal.dev — Minting',
    href: 'https://qortal.dev/wiki/minting',
  },
  {
    id: 'dev-mintership',
    label: 'qortal.dev — Q-Mintership',
    href: 'https://qortal.dev/wiki/q-mintership',
  },
  {
    id: 'dev-team',
    label: 'qortal.dev — Team',
    href: 'https://qortal.dev/team',
  },
  {
    id: 'dev-faq',
    label: 'qortal.dev — FAQ',
    href: 'https://qortal.dev/faq',
  },
  {
    id: 'crowetic-com',
    label: 'crowetic.com',
    blurb: 'Jason Crowe / Crowetic — projects & NuQloud',
    href: 'https://crowetic.com',
  },
  {
    id: 'playing-qortal-site',
    label: 'Playing Qortal',
    blurb: 'Playing Qortal material on QDN',
    service: 'WEBSITE',
    name: '... Playing Qortal ...',
  },
];

/** Open a QDN APP/WEBSITE in a new Hub/Go tab, or https in a new browser tab. */
export function openOfficialResource(link: OfficialResourceLink): void {
  if (link.href) {
    // External sites — park Qortino so the browser/sheet isn't covered.
    parkQortinoAgentSheet();
    window.open(link.href, '_blank', 'noopener,noreferrer');
    return;
  }
  if (link.service && link.name) {
    // Same path as openQAppInNewTab — park sheet so the new tab is visible.
    parkQortinoAgentSheet();
    executeEvent('addTab', {
      data: {
        service: link.service,
        name: link.name,
        path: '',
        navigateIfAlreadyOpen: true,
      },
    });
    executeEvent('open-apps-mode', {});
  }
}

/**
 * Suggest links for a user question. Always prefers QDN guides; adds
 * qortal.dev pages only when the topic clearly matches.
 */
export function suggestOfficialResources(
  query: string
): OfficialResourceLink[] {
  const t = query.trim().toLowerCase();
  if (!t) return [];

  const out: OfficialResourceLink[] = [];
  const add = (link: OfficialResourceLink) => {
    if (!out.some((x) => x.id === link.id)) out.push(link);
  };
  const byId = (id: string) =>
    [...OFFICIAL_QDN_GUIDES, ...OFFICIAL_WEB_LINKS].find((l) => l.id === id);

  const wantsMint =
    /\b(mint|minter|minting|mintership|nomination|nominate|sponsor|level\s*5|blocks?\s*minted|reward\s*share)\b/.test(
      t
    );
  const wantsStart =
    /\b(get started|getting started|new to qortal|beginner|onboard|first steps|how do i start)\b/.test(
      t
    );
  // Pure "what is qortal" stays FAQ-first; Welcome chip is optional orientation only.
  const wantsWelcomeChip =
    wantsStart ||
    /\bwelcome\s+to\s+qortal\b/.test(t) ||
    /\b(orientation|onboarding)\s+(app|q-?app)\b/.test(t);
  const wantsTeam =
    /\b(team|founder|founders|crowetic|jason crowe|\bice\b|dev admin|who (built|made|founded))\b/.test(
      t
    );
  const wantsSimon =
    /\bsimon\s+james\b/.test(t) || /\bplaying\s+qortal\b/.test(t);
  const wantsFaq =
    /\b(fee|seed phrase|name registration|hub vs|qortal go|recover)\b/.test(t);

  if (wantsStart) {
    add(byId('welcome')!);
    add(byId('q-minter-guide')!);
  } else if (wantsWelcomeChip) {
    add(byId('welcome')!);
  }
  // Definition asks: light orientation chip after the FAQ, not a person/app answer.
  if (
    /\bwhat\s+is\s+(the\s+)?qortal\b/.test(t) ||
    /\bhow\s+does\s+qortal\s+work\b/.test(t)
  ) {
    add(byId('welcome')!);
  }
  if (wantsMint) {
    add(byId('q-mintership')!);
    add(byId('q-minter-guide')!);
    add(byId('welcome')!);
    add(byId('dev-minting')!);
    add(byId('dev-mintership')!);
  }
  if (wantsTeam) {
    add(byId('dev-team')!);
    add(byId('welcome')!);
    if (/\b(crowetic|jason crowe)\b/.test(t)) {
      add(byId('crowetic-com')!);
    }
  }
  if (wantsSimon) {
    add(byId('playing-qortal-site')!);
  }
  if (wantsFaq && !wantsMint) {
    add(byId('dev-faq')!);
    add(byId('welcome')!);
  }

  return out.slice(0, 5);
}
