/**
 * Hub's own approval for a publish, the window Q-Apps get for theirs: what
 * goes up (service, name, identifier, file name) and the fee, Accept or
 * Decline. The Video publisher asks it right before a video goes up.
 */
import i18n from '../../i18n/i18n';
import { HUB_REQUEST } from '../../qortal/requestingApp';

export type ApprovalResource = {
  service: string;
  name: string;
  identifier: string;
  filename?: string;
};

export type PublishApprovalRequest = {
  resources: ApprovalResource[];
  /** The fee for all of them, in QORT. */
  fee: number;
};

/**
 * Accepted, or not: declined, or no answer within the minute Hub waits (as
 * for a Q-App).
 */
export async function requestPublishApproval({
  resources,
  fee,
}: PublishApprovalRequest): Promise<boolean> {
  // Loaded when first asked: the Q-App request handlers are big.
  const { getUserPermission } = await import('../../qortal/get');
  const answer = (await getUserPermission(
    {
      text1: i18n.t('question:permission.publish_qdn', {
        postProcess: 'capitalizeFirstChar',
      }),
      details: { type: 'resources', resources },
      fee,
    },
    // App's message handler opens its approval window only for requests
    // marked like this, as Hub marks the ones its Q-Apps send.
    true,
    // Hub's own request: the window names no app (never "Unknown Q-App").
    HUB_REQUEST
  )) as { accepted?: boolean } | false | undefined;
  return Boolean(answer && answer.accepted);
}
