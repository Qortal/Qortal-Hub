type ReticulumReactionEvent = {
  authorAddress?: unknown;
  authorPrimaryName?: unknown;
  authorSeq?: unknown;
  authorStreamId?: unknown;
  channelId?: unknown;
  encryptedPayload?: unknown;
  eventId?: unknown;
  eventType?: unknown;
  senderName?: unknown;
  targetEventId?: unknown;
  timestamp?: unknown;
};

export type ReticulumReactionReference = {
  reactions: Record<string, Array<Record<string, unknown>>>;
};

const eventOrder = (event: ReticulumReactionEvent) => ({
  authorSeq: Number.isSafeInteger(Number(event.authorSeq))
    ? Number(event.authorSeq)
    : null,
  authorStreamId:
    typeof event.authorStreamId === 'string' ? event.authorStreamId : '',
  eventId: typeof event.eventId === 'string' ? event.eventId : '',
  timestamp: Number.isFinite(Number(event.timestamp))
    ? Number(event.timestamp)
    : 0,
});

const compareReactionOrder = (
  left: ReticulumReactionEvent,
  right: ReticulumReactionEvent
) => {
  const leftOrder = eventOrder(left);
  const rightOrder = eventOrder(right);
  if (
    leftOrder.authorStreamId &&
    leftOrder.authorStreamId === rightOrder.authorStreamId &&
    leftOrder.authorSeq != null &&
    rightOrder.authorSeq != null
  ) {
    return (
      leftOrder.authorSeq - rightOrder.authorSeq ||
      leftOrder.eventId.localeCompare(rightOrder.eventId)
    );
  }
  return (
    leftOrder.timestamp - rightOrder.timestamp ||
    leftOrder.eventId.localeCompare(rightOrder.eventId)
  );
};

/**
 * Projects reaction events into their current per-message state. Reticulum can
 * deliver events in a different order from the order in which they were sent,
 * so projection compares each sender's events by signed author sequence when
 * they share a stream, falling back to timestamp and event id across streams.
 * Remove events are retained as state while projecting, which prevents an
 * older add from resurrecting a removed reaction.
 */
export const projectReticulumReactionReferences = (
  events: ReticulumReactionEvent[]
): Record<string, ReticulumReactionReference> => {
  const reactionsByTarget = new Map<
    string,
    Map<
      string,
      Map<
        string,
        {
          event: ReticulumReactionEvent;
          reaction: Record<string, unknown> | null;
        }
      >
    >
  >();

  for (const event of events) {
    if (
      event.eventType !== 'reaction_add' &&
      event.eventType !== 'reaction_remove'
    ) {
      continue;
    }
    const targetEventId =
      typeof event.targetEventId === 'string' ? event.targetEventId : '';
    const sender =
      typeof event.authorAddress === 'string' ? event.authorAddress : '';
    if (!targetEventId || !sender) continue;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(event.encryptedPayload || ''));
    } catch {
      continue;
    }
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!content) continue;

    const reactionsByContent =
      reactionsByTarget.get(targetEventId) ||
      new Map<
        string,
        Map<
          string,
          {
            event: ReticulumReactionEvent;
            reaction: Record<string, unknown> | null;
          }
        >
      >();
    reactionsByTarget.set(targetEventId, reactionsByContent);
    const reactionsBySender =
      reactionsByContent.get(content) ||
      new Map<
        string,
        {
          event: ReticulumReactionEvent;
          reaction: Record<string, unknown> | null;
        }
      >();
    reactionsByContent.set(content, reactionsBySender);

    const previous = reactionsBySender.get(sender);
    if (previous && compareReactionOrder(event, previous.event) <= 0) continue;

    if (event.eventType === 'reaction_remove') {
      reactionsBySender.set(sender, { event, reaction: null });
      continue;
    }
    reactionsBySender.set(sender, {
      event,
      reaction: {
        ...payload,
        channelId: event.channelId,
        eventType: event.eventType,
        id: event.eventId,
        signature: event.eventId,
        sender,
        senderName:
          event.authorPrimaryName ||
          (event.senderName !== event.authorAddress
            ? event.senderName
            : undefined),
        timestamp: event.timestamp,
      },
    });
  }

  const references: Record<string, ReticulumReactionReference> = {};
  for (const [targetEventId, reactionsByContent] of reactionsByTarget) {
    const reactions: Record<string, Array<Record<string, unknown>>> = {};
    for (const [content, reactionsBySender] of reactionsByContent) {
      const currentReactions = [...reactionsBySender.values()].flatMap(
        ({ reaction }) => (reaction ? [reaction] : [])
      );
      if (currentReactions.length > 0) {
        reactions[content] = currentReactions;
      }
    }
    if (Object.keys(reactions).length > 0) {
      references[targetEventId] = { reactions };
    }
  }
  return references;
};
