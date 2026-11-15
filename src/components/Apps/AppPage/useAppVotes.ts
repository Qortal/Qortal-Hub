import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../../App';
import { getFee } from '../../../background/background';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../../constants/constants';
import { useAppRating } from '../../../hooks/useAppRatings';
import type { PollInfo } from '../../../types/ratings';
import { normalizeAppIdentifier, normalizeAppService } from './appPageIds';
import {
  pendingVoteKey,
  pendingVotesAtom,
  watchPendingVoteOnPage,
} from './appPageStore';
import {
  applyPendingVote,
  fetchPollInfo,
  fetchPollVotes,
  isPendingVoteConfirmed,
  PENDING_VOTE_CHECK_MS,
  PENDING_VOTE_TTL,
  type PendingVote,
  PollVotes,
  ratingPollName,
  ratingName,
  RatingSummary,
  summarizeVoteCounts,
  summaryFromVoters,
  Voter,
  votersFromPoll,
} from './appVotes';

const sendBackground = (action: string, payload: Record<string, unknown>) =>
  new Promise<any>((resolve, reject) => {
    window
      .sendMessage(action, payload, TIME_MINUTES_1_IN_MILLISECONDS)
      .then((response: any) => {
        if (response?.error) reject(new Error(String(response.error)));
        else resolve(response);
      })
      .catch(reject);
  });

export type VoteResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; message?: string };

/**
 * The app's rating poll: who voted what, the user's own vote, and a summary
 * that already counts a vote the user just sent. A widget has a poll of its
 * own: give its identifier.
 */
export const useAppVotes = (
  app: { service?: string; name?: string; identifier?: string | null },
  me: { address?: string; name?: string }
) => {
  const service = normalizeAppService(app?.service);
  const identifier = normalizeAppIdentifier(app?.identifier);
  // The poll's subject: the app's name, or `<name>-id-<identifier>` for a
  // widget. The library's ratings and the pending votes go by it too.
  const name = app?.name ? ratingName(app.name, identifier) : '';
  // How the poll's description names it: `<name>/<identifier>` for a widget.
  const label = identifier ? `${app.name}/${identifier}` : name;
  const key = pendingVoteKey(me?.address, service, name);
  const { t } = useTranslation(['core']);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const { refresh: refreshCardRating } = useAppRating(name, service);
  const [pendingVotes, setPendingVotes] = useAtom(pendingVotesAtom);
  const stored = pendingVotes[key] || null;
  // Only the account that voted sees its vote on its way.
  const pending =
    stored && me?.address && stored.voter === me.address ? stored : null;

  const [poll, setPoll] = useState<PollInfo | null>(null);
  const [votes, setVotes] = useState<PollVotes | null>(null);
  const [loading, setLoading] = useState(!!name);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!name) return;
    const controller = new AbortController();
    const base = getBaseApiReact();
    setLoading(true);
    Promise.all([
      fetchPollInfo(base, service, name, controller.signal).catch(() => null),
      fetchPollVotes(base, service, name, controller.signal).catch(() => null),
    ]).then(([info, list]) => {
      if (controller.signal.aborted) return;
      setPoll(info);
      setVotes(info ? list : null);
      setLoading(false);
    });
    return () => controller.abort();
  }, [name, service, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);

  const voters: Voter[] = useMemo(
    () => (poll ? votersFromPoll(poll, votes?.votes || []) : []),
    [poll, votes]
  );
  const mine = useMemo(
    () =>
      (me?.address && voters.find((voter) => voter.address === me.address)) ||
      null,
    [voters, me?.address]
  );
  // Who voted is known here, so each person counts once.
  const confirmedSummary: RatingSummary = useMemo(
    () => (voters.length ? summaryFromVoters(voters) : summarizeVoteCounts([])),
    [voters]
  );
  const summary = useMemo(
    () => applyPendingVote(confirmedSummary, pending, mine),
    [confirmedSummary, pending, mine]
  );

  const dropPending = useCallback(
    () =>
      setPendingVotes((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      }),
    [key, setPendingVotes]
  );

  // Drop the pending vote once the node shows it. The library counts it
  // until then (optimisticRatings), so its rating is fetched first: the cards
  // and the Featured rows go from the pending vote to the node's without
  // losing it in between. A newer vote sent meanwhile stays.
  const confirmingRef = useRef<PendingVote | null>(null);
  useEffect(() => {
    if (!pending) return;
    if (isPendingVoteConfirmed(pending, mine)) {
      if (confirmingRef.current === pending) return;
      confirmingRef.current = pending;
      Promise.resolve(refreshCardRating())
        .catch(() => null)
        .finally(() =>
          setPendingVotes((previous) => {
            if (previous[key] !== pending) return previous;
            const next = { ...previous };
            delete next[key];
            return next;
          })
        );
    } else if (Date.now() - pending.sentAt > PENDING_VOTE_TTL) {
      dropPending();
    }
  }, [dropPending, key, mine, pending, refreshCardRating, setPendingVotes]);

  // Until then, look again every block or so (about a minute apart), and
  // give up when it's too old. Not tied to `mine`: a first vote leaves it
  // null until the node has it.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (Date.now() - pending.sentAt > PENDING_VOTE_TTL) dropPending();
      else reload();
    }, PENDING_VOTE_CHECK_MS);
    return () => clearInterval(timer);
  }, [dropPending, pending, reload]);

  // Once the page closes, PendingVotesWatcher looks for the vote instead.
  useEffect(() => watchPendingVoteOnPage(key), [key]);

  const vote = useCallback(
    async (rating: number): Promise<VoteResult> => {
      try {
        if (!me?.name) {
          return {
            ok: false,
            message: t('core:message.generic.name_rate', {
              postProcess: 'capitalizeFirstChar',
            }),
          };
        }
        if (!name || !(rating >= 1 && rating <= 5)) return { ok: false };
        if (pending?.createdPoll && !poll) {
          // A second CREATE_POLL would only fail, after its fee was asked.
          return {
            ok: false,
            message: t('core:app_page.rating.pending_first', {
              postProcess: 'capitalizeFirstChar',
            }),
          };
        }
        const currentRating = pending?.rating ?? mine?.rating ?? null;
        if (currentRating === rating && (!mine?.isInitial || pending)) {
          return {
            ok: false,
            message: t('core:message.error.app_already_voted', {
              postProcess: 'capitalizeFirstChar',
            }),
          };
        }
        const createsPoll = !poll;
        const fee = await getFee(createsPoll ? 'CREATE_POLL' : 'VOTE_ON_POLL');
        try {
          await show({
            message: t('core:message.question.rate_app', {
              rate: rating,
              postProcess: 'capitalizeFirstChar',
            }),
            publishFee: fee.fee + ' QORT',
          });
        } catch {
          return { ok: false, cancelled: true };
        }
        const pollName = ratingPollName(service, name);
        if (createsPoll) {
          await sendBackground('createPoll', {
            pollName,
            pollDescription: t('core:message.generic.rating', {
              name: label,
              service,
              postProcess: 'capitalizeFirstChar',
            }),
            pollOptions: [`1, 2, 3, 4, 5, initialValue-${rating}`],
            pollOwnerAddress: me.name,
          });
        } else {
          const optionIndex = poll.pollOptions.findIndex(
            (option) => Number(option.optionName) === rating
          );
          if (optionIndex === -1) {
            return {
              ok: false,
              message: t('core:message.error.rating_option', {
                postProcess: 'capitalizeFirstChar',
              }),
            };
          }
          await sendBackground('voteOnPoll', { pollName, optionIndex });
        }
        setPendingVotes((previous) => ({
          ...previous,
          [key]: {
            voter: me.address || '',
            rating,
            createdPoll: createsPoll,
            sentAt: Date.now(),
            name,
            service,
            // The library moves this vote from the voter's earlier one.
            replaces: mine && !mine.isInitial ? mine.rating : null,
          },
        }));
        return { ok: true };
      } catch (error: any) {
        const message = String(error?.message || error || '');
        return {
          ok: false,
          message: message.includes('ALREADY_VOTED_FOR_THAT_OPTION')
            ? t('core:message.error.app_already_voted', {
                postProcess: 'capitalizeFirstChar',
              })
            : message ||
              t('core:message.error.rate', {
                postProcess: 'capitalizeFirstChar',
              }),
        };
      }
    },
    [
      key,
      label,
      me?.address,
      me?.name,
      mine,
      name,
      pending,
      poll,
      service,
      setPendingVotes,
      show,
      t,
    ]
  );

  return {
    loading,
    pollExists: !!poll,
    summary,
    voters,
    mine,
    pending,
    vote,
    reload,
  };
};
