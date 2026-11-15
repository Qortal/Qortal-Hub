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
import { appReviewKey, normalizeAppService } from './appPageIds';
import { appStoreKey, pendingReviewsAtom } from './appPageStore';
import {
  buildReviewThreads,
  deleteReviewItem,
  fetchReviewRecord,
  isPendingReviewListed,
  PendingReview,
  publishReply,
  publishReview,
  ReviewItem,
  reviewItemKey,
  ReviewKind,
  ReviewRecord,
  ReviewResource,
  ReviewSearchPage,
  searchAppReviews,
  SentReview,
  withPrevious,
} from './appReviews';

const PAGE_SIZE = 50;
const REPLY_PAGE_SIZE = 100;
const PENDING_TTL = 15 * 60 * 1000;
/** Replies whose review isn't on a loaded page: look up this many reviews. */
const MAX_PARENT_LOOKUPS = 10;
/** A record the node couldn't serve yet: ask again this often, this many times. */
const RECORD_RETRY_MS = 20_000;
const RECORD_TRIES = 3;

const recordCache = new Map<string, ReviewRecord | null>();
const recordFailures = new Map<string, number>();
const recordCacheKey = (resource: ReviewResource) =>
  `${reviewItemKey(resource.name, resource.identifier)}\n${resource.updated}`;

/** Forgets loaded records (tests start each case clean). */
export const clearReviewRecordCache = () => {
  recordCache.clear();
  recordFailures.clear();
};

export type ReviewActionResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; message?: string };

type Rows = Record<ReviewKind, number>;

/** One list, each item once, the newest version of each. */
const mergeResources = (...lists: ReviewResource[][]): ReviewResource[] => {
  const byKey = new Map<string, ReviewResource>();
  lists.flat().forEach((item) => {
    const key = reviewItemKey(item.name, item.identifier);
    const known = byKey.get(key);
    if (!known || item.updated > known.updated) byKey.set(key, item);
  });
  return Array.from(byKey.values());
};

/** Reviews and replies of an app, with the user's own actions on them. */
export const useAppReviews = (
  app: { service?: string; name?: string },
  me: { name?: string }
) => {
  const service = normalizeAppService(app?.service);
  const name = app?.name || '';
  const myName = me?.name || '';
  const key = appStoreKey(service, name);
  const { t } = useTranslation(['core']);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [pendingByApp, setPendingByApp] = useAtom(pendingReviewsAtom);
  const pending = useMemo(() => pendingByApp[key] || [], [pendingByApp, key]);

  const [resources, setResources] = useState<ReviewResource[]>([]);
  const [records, setRecords] = useState<Map<string, ReviewRecord | null>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(!!name);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState<Record<ReviewKind, boolean>>({
    review: false,
    reply: false,
  });
  const [token, setToken] = useState(0);
  const [recordRetry, setRecordRetry] = useState(0);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  // Rows loaded per kind, so a reload brings back as many as Load more did.
  const rowsRef = useRef<{ key: string; rows: Rows }>({
    key: '',
    rows: { review: 0, reply: 0 },
  });
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** The reviews that loaded replies answer but no loaded page holds. */
  const findParents = useCallback(
    async (
      replies: ReviewResource[],
      reviews: ReviewResource[],
      signal?: AbortSignal
    ) => {
      const known = new Set(reviews.map((item) => item.name.toLowerCase()));
      // Each missing review once, looked up by its name as the reply has it.
      const missing = new Map<string, string>();
      replies.forEach((item) => {
        const parent = item.parentName?.trim();
        if (!parent || known.has(parent.toLowerCase())) return;
        if (!missing.has(parent.toLowerCase())) {
          missing.set(parent.toLowerCase(), parent);
        }
      });
      const found = await Promise.all(
        Array.from(missing.values())
          .slice(0, MAX_PARENT_LOOKUPS)
          .map((parent) =>
            searchAppReviews(
              getBaseApiReact(),
              { service, name },
              { kind: 'review', name: parent, limit: 5, signal }
            ).then(
              (page) => page.items,
              () => [] as ReviewResource[]
            )
          )
      );
      return found.flat();
    },
    [name, service]
  );

  useEffect(() => {
    if (!name) return;
    const controller = new AbortController();
    const { signal } = controller;
    const base = getBaseApiReact();
    const ref = { service, name };
    const sameApp = rowsRef.current.key === key;
    const rows = sameApp ? rowsRef.current.rows : { review: 0, reply: 0 };
    if (!sameApp) {
      setResources([]);
      setMore({ review: false, reply: false });
    }
    const empty: ReviewSearchPage = { items: [], rows: 0 };
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const reviewLimit = Math.max(PAGE_SIZE, rows.review);
        const replyLimit = Math.max(REPLY_PAGE_SIZE, rows.reply);
        const [reviews, replies, own] = await Promise.all([
          searchAppReviews(base, ref, {
            kind: 'review',
            limit: reviewLimit,
            signal,
          }),
          searchAppReviews(base, ref, {
            kind: 'reply',
            limit: replyLimit,
            signal,
          }),
          // The user's own review, so it can be edited from any page.
          myName
            ? searchAppReviews(base, ref, {
                kind: 'review',
                name: myName,
                limit: 5,
                signal,
              }).catch(() => empty)
            : Promise.resolve(empty),
        ]);
        const parents = await findParents(
          replies.items,
          [...reviews.items, ...own.items],
          signal
        );
        if (signal.aborted) return;
        rowsRef.current = {
          key,
          rows: { review: reviews.rows, reply: replies.rows },
        };
        setResources(
          mergeResources(reviews.items, own.items, parents, replies.items)
        );
        setMore({
          review: reviews.rows >= reviewLimit,
          reply: replies.rows >= replyLimit,
        });
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError' && !signal.aborted) {
          setFailed(true);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [findParents, key, myName, name, service, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);

  const loadMore = useCallback(async () => {
    const base = getBaseApiReact();
    const ref = { service, name };
    const { rows } = rowsRef.current;
    const kinds = (['review', 'reply'] as ReviewKind[]).filter(
      (kind) => more[kind]
    );
    try {
      const pages = await Promise.all(
        kinds.map((kind) =>
          searchAppReviews(base, ref, {
            kind,
            limit: kind === 'reply' ? REPLY_PAGE_SIZE : PAGE_SIZE,
            offset: rows[kind],
          })
        )
      );
      const added = pages.flatMap((page) => page.items);
      const parents = await findParents(
        added.filter((item) => item.kind === 'reply'),
        [
          ...resourcesRef.current.filter((item) => item.kind === 'review'),
          ...added.filter((item) => item.kind === 'review'),
        ]
      );
      if (!mounted.current || rowsRef.current.key !== key) return;
      const nextRows = { ...rowsRef.current.rows };
      const nextMore = { ...more };
      kinds.forEach((kind, index) => {
        const size = kind === 'reply' ? REPLY_PAGE_SIZE : PAGE_SIZE;
        nextRows[kind] += pages[index].rows;
        nextMore[kind] = pages[index].rows >= size;
      });
      rowsRef.current = { key, rows: nextRows };
      setResources((previous) => mergeResources(previous, added, parents));
      setMore(nextMore);
    } catch {
      setMore({ review: false, reply: false });
    }
  }, [findParents, key, more, name, service]);

  // Load each record once per version; the search shows only a snippet.
  useEffect(() => {
    const base = getBaseApiReact();
    const queue = resources.filter((resource) => {
      const cacheKey = recordCacheKey(resource);
      return (
        !recordCache.has(cacheKey) &&
        !inFlight.current.has(cacheKey) &&
        (recordFailures.get(cacheKey) || 0) < RECORD_TRIES
      );
    });
    const known = new Map<string, ReviewRecord | null>();
    resources.forEach((resource) => {
      const cacheKey = recordCacheKey(resource);
      if (recordCache.has(cacheKey)) {
        known.set(
          reviewItemKey(resource.name, resource.identifier),
          recordCache.get(cacheKey) ?? null
        );
      }
    });
    setRecords(known);
    if (queue.length === 0) return;
    let alive = true;
    let next = 0;
    let unavailable = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const worker = async () => {
      while (alive && next < queue.length) {
        const resource = queue[next++];
        const cacheKey = recordCacheKey(resource);
        inFlight.current.add(cacheKey);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const record = await fetchReviewRecord(
          base,
          resource.name,
          resource.identifier,
          controller.signal
        ).catch(() => undefined);
        clearTimeout(timer);
        inFlight.current.delete(cacheKey);
        if (record === undefined) {
          // Not on the node yet (or it timed out): try again in a while.
          recordFailures.set(cacheKey, (recordFailures.get(cacheKey) || 0) + 1);
          unavailable = true;
          continue;
        }
        recordCache.set(cacheKey, record);
        // A record that lands after the list changed is still the right one.
        if (!mounted.current) return;
        setRecords((previous) => {
          const updated = new Map(previous);
          updated.set(
            reviewItemKey(resource.name, resource.identifier),
            record
          );
          return updated;
        });
      }
    };
    Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, () => worker())
    ).then(() => {
      if (alive && unavailable && mounted.current) {
        retryTimer = setTimeout(
          () => setRecordRetry((value) => value + 1),
          RECORD_RETRY_MS
        );
      }
    });
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [resources, recordRetry]);

  // Forget sent items the node now lists (or that are too old); until then,
  // look again every so often.
  useEffect(() => {
    if (pending.length === 0 || loading) return;
    const listed = new Map(
      resources.map((item) => [reviewItemKey(item.name, item.identifier), item])
    );
    const still = pending.filter(
      (entry) =>
        !isPendingReviewListed(
          entry,
          listed.get(reviewItemKey(entry.name, entry.identifier))
        ) && Date.now() - entry.sentAt < PENDING_TTL
    );
    if (still.length !== pending.length) {
      setPendingByApp((previous) => ({ ...previous, [key]: still }));
      return;
    }
    const timer = setTimeout(reload, 15_000);
    return () => clearTimeout(timer);
  }, [key, loading, pending, reload, resources, setPendingByApp]);

  const threads = useMemo(
    () => buildReviewThreads(resources, records, pending),
    [resources, records, pending]
  );

  const myReview: ReviewItem | null = useMemo(() => {
    if (!myName) return null;
    const lower = myName.toLowerCase();
    return (
      threads.find(
        (thread) =>
          thread.review.name.toLowerCase() === lower && !thread.review.deleted
      )?.review || null
    );
  }, [myName, threads]);

  /** What the node lists, and what was sent, for an item about to change. */
  const snapshot = useCallback((author: string, identifier: string) => {
    const itemKey = reviewItemKey(author, identifier);
    return {
      listed: resourcesRef.current.find(
        (item) => reviewItemKey(item.name, item.identifier) === itemKey
      ),
      earlier: pendingRef.current.find(
        (item) => reviewItemKey(item.name, item.identifier) === itemKey
      ),
    };
  }, []);

  const addPending = useCallback(
    (entry: PendingReview) =>
      setPendingByApp((previous) => {
        const list = (previous[key] || []).filter(
          (item) =>
            reviewItemKey(item.name, item.identifier) !==
            reviewItemKey(entry.name, entry.identifier)
        );
        return { ...previous, [key]: [...list, entry] };
      }),
    [key, setPendingByApp]
  );

  const genericError = useCallback(
    () =>
      t('core:message.error.generic', {
        postProcess: 'capitalizeFirstChar',
      }),
    [t]
  );

  const run = useCallback(
    async (
      message: string,
      target: { name: string; identifier: string } | null,
      action: () => Promise<SentReview>
    ): Promise<ReviewActionResult> => {
      if (!myName) {
        return {
          ok: false,
          message: t('core:app_page.reviews.name_needed', {
            postProcess: 'capitalizeFirstChar',
          }),
        };
      }
      let fee: { fee: string };
      try {
        fee = await getFee('ARBITRARY');
      } catch (error: any) {
        // The node can't be reached: say so, rather than act as if cancelled.
        return { ok: false, message: error?.message || genericError() };
      }
      try {
        await show({ message, publishFee: fee.fee + ' QORT' });
      } catch {
        return { ok: false, cancelled: true };
      }
      const before = target
        ? snapshot(target.name, target.identifier)
        : { listed: undefined, earlier: undefined };
      try {
        addPending(withPrevious(await action(), before.listed, before.earlier));
        return { ok: true };
      } catch (error: any) {
        return { ok: false, message: error?.message || genericError() };
      }
    },
    [addPending, genericError, myName, show, snapshot, t]
  );

  const submitReview = useCallback(
    (text: string) =>
      run(
        t(
          myReview
            ? 'core:app_page.reviews.confirm_update'
            : 'core:app_page.reviews.confirm_publish',
          { postProcess: 'capitalizeFirstChar' }
        ),
        { name: myName, identifier: appReviewKey(service, name) },
        () =>
          publishReview({ service, name }, myName, text, {
            created: myReview?.created,
          })
      ),
    [myName, myReview, name, run, service, t]
  );

  const submitReply = useCallback(
    (parentName: string, text: string) =>
      run(
        t('core:app_page.reviews.confirm_reply', {
          postProcess: 'capitalizeFirstChar',
        }),
        null,
        () =>
          publishReply(
            { service, name },
            myName,
            { name: parentName, identifier: appReviewKey(service, name) },
            text
          )
      ),
    [myName, name, run, service, t]
  );

  const removeItem = useCallback(
    (item: ReviewItem) =>
      run(
        t(
          item.kind === 'reply'
            ? 'core:app_page.reviews.confirm_delete_reply'
            : 'core:app_page.reviews.confirm_delete_review',
          { postProcess: 'capitalizeFirstChar' }
        ),
        { name: item.name, identifier: item.identifier },
        () => deleteReviewItem({ service, name }, myName, item)
      ),
    [myName, name, run, service, t]
  );

  return {
    loading,
    failed,
    hasMore: more.review || more.reply,
    threads,
    myReview,
    reload,
    loadMore,
    submitReview,
    submitReply,
    removeItem,
  };
};
