type ReticulumChatRow = Record<string, any>;
type ReticulumResourceRow = Record<string, any>;
type ReticulumResourceChunkRow = Record<string, any>;
type ReticulumResourceStateRow = Record<string, any>;

type MockStore = {
  reticulumChatEvents: ReticulumChatRow[];
  reticulumChatEventHeaders: ReticulumChatRow[];
  reticulumChatMessages: ReticulumChatRow[];
  reticulumChatExpiredEventMarkers: ReticulumChatRow[];
  reticulumChatRejectedEventMarkers: ReticulumChatRow[];
  reticulumChatRejectedDigestMarkers: ReticulumChatRow[];
  reticulumChatMetadataSnapshots: ReticulumChatRow[];
  reticulumChatMetadataEntityRevisions: ReticulumChatRow[];
  reticulumChatChannels: ReticulumChatRow[];
  reticulumChatChannelExpiryReconciliations: ReticulumChatRow[];
  reticulumChatSchemaMigrations: Map<string, number>;
  reticulumChatAuthorStreams: Map<string, string>;
  reticulumChatAuthorSequenceLeases: ReticulumChatRow[];
  reticulumChatMissingRangePeerObservations: ReticulumChatRow[];
  reticulumChatKnownUnavailableRanges: ReticulumChatRow[];
  reticulumChatSilences: ReticulumChatRow[];
  reticulumPublicGroupActivity: ReticulumChatRow[];
  reticulumCalendarMutations: ReticulumChatRow[];
  reticulumCalendarEvents: ReticulumChatRow[];
  reticulumCalendarReminders: ReticulumChatRow[];
  reticulumDmEvents: ReticulumChatRow[];
  reticulumDmExpiredEventMarkers: ReticulumChatRow[];
  reticulumDmExpiryPreferences: ReticulumChatRow[];
  reticulumDmReadWatermarks: ReticulumChatRow[];
  reticulumDirectCallHistory: ReticulumChatRow[];
  reticulumDeviceReadStates: ReticulumChatRow[];
  reticulumPendingDeviceReadStates: ReticulumChatRow[];
  reticulumResources: ReticulumResourceRow[];
  reticulumResourceChunks: ReticulumResourceChunkRow[];
  reticulumResourceRanges: ReticulumResourceStateRow[];
  reticulumResourceGroupRefs: ReticulumResourceStateRow[];
  reticulumResourceRefs: ReticulumResourceStateRow[];
  reticulumResourceLeases: ReticulumResourceStateRow[];
  reticulumResourceReservations: ReticulumResourceStateRow[];
  reticulumResourceProviders: ReticulumResourceStateRow[];
  reticulumResourceMeta: Map<string, string>;
  schema: Map<string, Set<string>>;
};

const storesByPath = new Map<string, MockStore>();

class Statement {
  constructor(
    private readonly sql: string,
    private readonly store: MockStore
  ) {}

  all(...args: any[]) {
    const pragmaMatch = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i);
    if (pragmaMatch) {
      const tableName =
        pragmaMatch[1]?.trim().replace(/^["'`]|["'`]$/g, '') ?? '';
      return [...(this.store.schema.get(tableName) ?? new Set<string>())].map(
        (name, cid) => ({
          cid,
          name,
        })
      );
    }
    if (this.sql.includes('FROM rchat_known_unavailable_ranges')) {
      const [groupId] = args;
      return this.store.reticulumChatKnownUnavailableRanges.filter(
        (row) => row.group_id === groupId
      );
    }
    if (
      this.sql.includes('FROM rchat_calendar_events e') &&
      this.sql.includes('JOIN rchat_calendar_mutations m')
    ) {
      const groupId = Number(args[0]);
      let rows = this.store.reticulumCalendarEvents.filter(
        (row) => Number(row.group_id) === groupId
      );
      if (this.sql.includes('e.deleted = 0')) {
        rows = rows.filter((row) => Number(row.deleted) === 0);
      }
      if (this.sql.includes('e.recurring = 0')) {
        rows = rows.filter((row) => Number(row.recurring) === 0);
      } else if (this.sql.includes('e.recurring = 1')) {
        rows = rows.filter((row) => Number(row.recurring) === 1);
      }
      rows.sort(
        (left, right) =>
          Number(left.start_at || 0) - Number(right.start_at || 0) ||
          String(left.event_id).localeCompare(String(right.event_id))
      );
      if (this.sql.includes('SELECT e.mutation_id')) {
        return rows.map((row) => {
          const mutation = this.store.reticulumCalendarMutations.find(
            (candidate) => candidate.mutation_id === row.mutation_id
          );
          return {
            mutation_id: row.mutation_id,
            mutation_json: mutation?.mutation_json,
          };
        });
      }
      const limit = Number(args.at(-1));
      return rows
        .map((row) =>
          this.store.reticulumCalendarMutations.find(
            (candidate) => candidate.mutation_id === row.mutation_id
          )
        )
        .filter(Boolean)
        .slice(0, Number.isFinite(limit) ? limit : undefined)
        .map((row) => ({ mutation_json: row?.mutation_json }));
    }
    if (this.sql.includes('FROM rchat_author_sequence_leases')) {
      if (this.sql.includes('SELECT DISTINCT owner_id, owner_pid')) {
        const owners = new Map<string, number>();
        for (const row of this.store.reticulumChatAuthorSequenceLeases) {
          owners.set(row.owner_id, row.owner_pid);
        }
        return [...owners].map(([owner_id, owner_pid]) => ({
          owner_id,
          owner_pid,
        }));
      }
      return [...this.store.reticulumChatAuthorSequenceLeases];
    }
    if (this.sql.includes('FROM rchat_direct_call_history')) {
      const ownerAddress = args[0];
      const peerFiltered = this.sql.includes('AND peer_address = ?');
      const peerAddress = peerFiltered ? args[1] : undefined;
      const limit = Number(args[peerFiltered ? 2 : 1]) || 250;
      let rows = this.store.reticulumDirectCallHistory.filter(
        (row) =>
          row.owner_address === ownerAddress &&
          (!peerFiltered || row.peer_address === peerAddress)
      );
      if (this.sql.includes("direction = 'incoming' AND outcome = 'missed'")) {
        rows = rows.filter(
          (row) =>
            row.direction === 'incoming' &&
            row.outcome === 'missed' &&
            Number(row.read_at) === 0
        );
      }
      rows = rows.sort(
        (a, b) =>
          Number(b.ended_at) - Number(a.ended_at) ||
          String(b.call_id).localeCompare(String(a.call_id))
      );
      if (!this.sql.includes('AS unread_missed_count'))
        return rows.slice(0, limit);
      const latestByPeer = new Map<string, ReticulumChatRow>();
      for (const row of rows) {
        if (!latestByPeer.has(row.peer_address))
          latestByPeer.set(row.peer_address, row);
      }
      return [...latestByPeer.values()].map((row) => ({
        ...row,
        unread_missed_count: this.store.reticulumDirectCallHistory.filter(
          (candidate) =>
            candidate.owner_address === ownerAddress &&
            candidate.peer_address === row.peer_address &&
            candidate.direction === 'incoming' &&
            candidate.outcome === 'missed' &&
            Number(candidate.read_at) === 0
        ).length,
      }));
    }
    if (
      this.sql.includes('FROM rchat_rejected_event_markers') &&
      this.sql.includes('SELECT author_seq')
    ) {
      const [groupId, authorAddress, authorStreamId, fromSeq, toSeq] = args;
      return this.store.reticulumChatRejectedEventMarkers
        .filter(
          (row) =>
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            row.author_stream_id === authorStreamId &&
            Number(row.author_seq) >= Number(fromSeq) &&
            Number(row.author_seq) <= Number(toSeq)
        )
        .sort((left, right) => Number(left.author_seq) - Number(right.author_seq))
        .map((row) => ({ author_seq: row.author_seq }));
    }
    if (this.sql.includes('FROM rchat_missing_range_peer_observations')) {
      const [groupId, authorAddress, authorStreamId, fromSeq, toSeq] = args;
      const matching =
        this.store.reticulumChatMissingRangePeerObservations.filter(
          (row) =>
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            row.author_stream_id === authorStreamId &&
            row.from_seq <= fromSeq &&
            row.to_seq >= toSeq
        );
      if (!this.sql.includes('GROUP BY peer_hash')) return matching;
      const newestByPeer = new Map<string, ReticulumChatRow>();
      for (const row of matching) {
        const existing = newestByPeer.get(String(row.peer_hash));
        if (
          !existing ||
          Number(row.observed_at) > Number(existing.observed_at)
        ) {
          newestByPeer.set(String(row.peer_hash), row);
        }
      }
      return [...newestByPeer.values()];
    }
    if (this.sql.includes('FROM rchat_silences')) {
      const [ownerAddress, scopeType, scopeId] = args;
      return this.store.reticulumChatSilences
        .filter(
          (row) =>
            row.owner_address === ownerAddress &&
            (!this.sql.includes('scope_type = ?') ||
              row.scope_type === scopeType) &&
            (!this.sql.includes('scope_id = ?') || row.scope_id === scopeId)
        )
        .sort(
          (a, b) =>
            Number(b.updated_at) - Number(a.updated_at) ||
            String(a.target_address).localeCompare(String(b.target_address))
        );
    }
    if (this.sql.includes('FROM rchat_public_group_activity')) {
      const limit = Math.max(1, Number(args[0]) || 200);
      return this.store.reticulumPublicGroupActivity
        .filter(
          (row) => row.local_state_json != null || Number(row.observed_at) > 0
        )
        .sort(
          (a, b) =>
            Number(b.active_authors_7d) - Number(a.active_authors_7d) ||
            Number(b.messages_24h) - Number(a.messages_24h) ||
            Number(b.messages_7d) - Number(a.messages_7d) ||
            Number(b.observed_at) - Number(a.observed_at) ||
            Number(a.group_id) - Number(b.group_id)
        )
        .slice(0, limit);
    }
    if (this.sql.includes('FROM rchat_pending_device_read_state')) {
      const [ownerAddress, limit = 5_000] = args;
      return this.store.reticulumPendingDeviceReadStates
        .filter((pending) => {
          if (pending.owner_address !== ownerAddress) return false;
          const signed = this.store.reticulumDeviceReadStates.find(
            (state) =>
              state.owner_address === pending.owner_address &&
              state.scope_type === pending.scope_type &&
              state.scope_id === pending.scope_id
          );
          return (
            Number(pending.up_to_timestamp) >
            Number(signed?.up_to_timestamp || 0)
          );
        })
        .sort(
          (a, b) =>
            Number(a.updated_at) - Number(b.updated_at) ||
            String(a.scope_type).localeCompare(String(b.scope_type)) ||
            String(a.scope_id).localeCompare(String(b.scope_id))
        )
        .slice(0, Number(limit));
    }
    if (this.sql.includes('FROM rchat_device_read_state')) {
      const [ownerAddress, limit = 2_000] = args;
      return this.store.reticulumDeviceReadStates
        .filter((row) => row.owner_address === ownerAddress)
        .sort(
          (a, b) =>
            Number(b.signed_at) - Number(a.signed_at) ||
            String(a.scope_type).localeCompare(String(b.scope_type)) ||
            String(a.scope_id).localeCompare(String(b.scope_id))
        )
        .slice(0, Number(limit));
    }
    if (this.sql.includes('FROM rchat_dm_events')) {
      if (
        this.sql.includes("event_type = 'message'") &&
        this.sql.includes('expires_at <= ?')
      ) {
        const [now, limit = 1000] = args;
        return this.store.reticulumDmEvents
          .filter(
            (row) =>
              row.event_type === 'message' &&
              row.expires_at != null &&
              Number(row.expires_at) <= Number(now)
          )
          .sort(
            (a, b) =>
              Number(a.expires_at) - Number(b.expires_at) ||
              String(a.event_id).localeCompare(String(b.event_id))
          )
          .slice(0, Number(limit));
      }
      if (this.sql.includes('WHERE event_id = ? OR target_event_id = ?')) {
        const [eventId, targetEventId] = args;
        return this.store.reticulumDmEvents.filter(
          (row) =>
            row.event_id === eventId || row.target_event_id === targetEventId
        );
      }
      if (this.sql.includes('SELECT e.*')) {
        const [address] = args;
        const conversationId = this.sql.includes('AND e.conversation_id = ?')
          ? args[2]
          : '';
        const now = Number(args[args.length - 1]);
        const latestByConversation = new Map<string, ReticulumChatRow>();
        for (const row of this.store.reticulumDmEvents) {
          if (
            row.sender_address !== address &&
            row.recipient_address !== address
          ) {
            continue;
          }
          if (conversationId && row.conversation_id !== conversationId) {
            continue;
          }
          if (row.expires_at != null && Number(row.expires_at) <= now) {
            continue;
          }
          const existing = latestByConversation.get(row.conversation_id);
          if (
            existing &&
            (Number(existing.timestamp) > Number(row.timestamp) ||
              (Number(existing.timestamp) === Number(row.timestamp) &&
                String(existing.event_id) > String(row.event_id)))
          ) {
            continue;
          }
          latestByConversation.set(row.conversation_id, row);
        }
        return [...latestByConversation.values()].sort(
          (a, b) =>
            Number(b.timestamp) - Number(a.timestamp) ||
            String(b.event_id).localeCompare(String(a.event_id))
        );
      }
      if (this.sql.includes('WHERE conversation_id = ?')) {
        const conversationId = args[0];
        const limit = Number(args[args.length - 1]) || Infinity;
        const excluded = this.sql.includes('sender_address NOT IN')
          ? new Set(args.slice(1, -1).map(String))
          : new Set<string>();
        return this.store.reticulumDmEvents
          .filter(
            (row) =>
              row.conversation_id === conversationId &&
              !excluded.has(String(row.sender_address))
          )
          .sort(
            (a, b) =>
              Number(b.timestamp) - Number(a.timestamp) ||
              String(b.event_id).localeCompare(String(a.event_id))
          )
          .slice(0, limit)
          .reverse();
      }
    }
    if (this.sql.includes('FROM rchat_event_headers')) {
      const [groupId, _sameGroupId, limit, offset = 0] = args;
      const knownRows = [
        ...this.store.reticulumChatEventHeaders,
        ...this.store.reticulumChatExpiredEventMarkers,
      ].filter((row) => row.group_id === groupId);
      if (this.sql.includes('previous_seq + 1 AS from_seq')) {
        const rowsByAuthor = new Map<string, ReticulumChatRow[]>();
        for (const row of knownRows) {
          const key = `${row.author_address}:${row.author_stream_id || ''}`;
          const rows = rowsByAuthor.get(key) ?? [];
          rows.push(row);
          rowsByAuthor.set(key, rows);
        }
        const gaps: ReticulumChatRow[] = [];
        for (const rows of rowsByAuthor.values()) {
          rows.sort((a, b) => Number(a.author_seq) - Number(b.author_seq));
          for (let index = 1; index < rows.length; index += 1) {
            const previousSeq = Number(rows[index - 1].author_seq);
            const authorSeq = Number(rows[index].author_seq);
            if (authorSeq <= previousSeq + 1) continue;
            gaps.push({
              author_address: rows[index].author_address,
              author_stream_id: rows[index].author_stream_id || '',
              from_seq: previousSeq + 1,
              to_seq: authorSeq - 1,
            });
          }
        }
        return gaps
          .sort(
            (a, b) =>
              Number(b.to_seq) - Number(a.to_seq) ||
              String(a.author_address).localeCompare(
                String(b.author_address)
              ) ||
              Number(b.from_seq) - Number(a.from_seq)
          )
          .slice(0, Number(limit) || undefined);
      }
      if (
        this.sql.includes('author_seq >= ?') &&
        this.sql.includes('author_seq <= ?')
      ) {
        const [rangeGroupId, authorAddress, authorStreamId, fromSeq, toSeq] =
          args;
        return knownRows
          .filter(
            (row) =>
              row.group_id === rangeGroupId &&
              row.author_address === authorAddress &&
              String(row.author_stream_id || '') ===
                String(authorStreamId || '') &&
              Number(row.author_seq) >= Number(fromSeq) &&
              Number(row.author_seq) <= Number(toSeq)
          )
          .sort((a, b) => Number(a.author_seq) - Number(b.author_seq))
          .map((row) => ({ author_seq: row.author_seq }));
      }
      const byAuthor = new Map<string, ReticulumChatRow>();
      for (const row of knownRows) {
        const key = `${row.author_address}:${row.author_stream_id || ''}`;
        const existing = byAuthor.get(key);
        if (
          existing &&
          (Number(existing.author_seq) > Number(row.author_seq) ||
            (Number(existing.author_seq) === Number(row.author_seq) &&
              (Number(existing.timestamp) > Number(row.timestamp) ||
                (Number(existing.timestamp) === Number(row.timestamp) &&
                  String(existing.event_id) >= String(row.event_id)))))
        ) {
          continue;
        }
        byAuthor.set(key, row);
      }
      if (this.sql.includes('e.author_seq AS max_seq')) {
        return [...byAuthor.values()]
          .sort(
            (a, b) =>
              Number(b.timestamp) - Number(a.timestamp) ||
              String(b.event_id).localeCompare(String(a.event_id))
          )
          .slice(
            Number(offset) || 0,
            (Number(offset) || 0) + (Number(limit) || Infinity)
          )
          .map((row) => ({
            author_address: row.author_address,
            author_stream_id: row.author_stream_id || '',
            max_seq: row.author_seq,
            event_id: row.event_id,
            timestamp: row.timestamp,
          }));
      }
      if (this.sql.includes('GROUP BY author_address')) {
        const sequenceField = this.sql.includes('AS seq') ? 'seq' : 'max_seq';
        return [...byAuthor.values()]
          .sort(
            (a, b) =>
              String(a.author_address).localeCompare(
                String(b.author_address)
              ) ||
              String(a.author_stream_id || '').localeCompare(
                String(b.author_stream_id || '')
              )
          )
          .map((row) => ({
            author_address: row.author_address,
            author_stream_id: row.author_stream_id || '',
            [sequenceField]: row.author_seq,
          }));
      }
      return [...this.store.reticulumChatEventHeaders];
    }
    if (this.sql.includes('FROM rchat_metadata_snapshots')) {
      const [groupId, scope] = args;
      return this.store.reticulumChatMetadataSnapshots
        .filter(
          (row) =>
            row.group_id === groupId && (scope == null || row.scope === scope)
        )
        .sort(
          (a, b) =>
            b.version - a.version ||
            b.created_at - a.created_at ||
            String(b.snapshot_hash).localeCompare(String(a.snapshot_hash))
        );
    }
    if (this.sql.includes('FROM rchat_metadata_entity_revisions')) {
      const [groupId] = args;
      return this.store.reticulumChatMetadataEntityRevisions
        .filter((row) => row.group_id === groupId)
        .sort(
          (a, b) =>
            String(a.entity_type).localeCompare(String(b.entity_type)) ||
            String(a.entity_id).localeCompare(String(b.entity_id))
        );
    }
    if (this.sql.includes('FROM rchat_channel_expiry_reconciliation')) {
      const [groupId] = args;
      return this.store.reticulumChatChannelExpiryReconciliations
        .filter((row) => groupId == null || row.group_id === groupId)
        .sort(
          (a, b) =>
            Number(a.group_id) - Number(b.group_id) ||
            String(a.channel_id).localeCompare(String(b.channel_id))
        );
    }
    if (this.sql.includes('FROM reticulum_chat_channels')) {
      const [groupId] = args;
      return this.store.reticulumChatChannels
        .filter((row) => row.group_id === groupId)
        .sort(
          (a, b) =>
            Number(a.position) - Number(b.position) ||
            String(a.name).localeCompare(String(b.name)) ||
            String(a.channel_id).localeCompare(String(b.channel_id))
        );
    }
    if (this.sql.includes('FROM rchat_message_projection')) {
      if (
        this.sql.includes('expires_at IS NOT NULL') &&
        this.sql.includes('expires_at <= ?')
      ) {
        const [now, limit = Infinity] = args;
        return this.store.reticulumChatMessages
          .filter(
            (row) =>
              row.expires_at != null && Number(row.expires_at) <= Number(now)
          )
          .sort(
            (a, b) =>
              Number(a.expires_at) - Number(b.expires_at) ||
              String(a.root_event_id).localeCompare(String(b.root_event_id))
          )
          .slice(0, Number(limit) || Infinity)
          .map((row) => ({ root_event_id: row.root_event_id }));
      }
      if (
        this.sql.includes('author_address NOT IN') &&
        this.sql.includes('SELECT * FROM (') &&
        !this.sql.includes('p.author_address')
      ) {
        const groupId = args[0];
        const hasChannel = this.sql.includes('channel_id = ?');
        const channelId = hasChannel ? args[1] : null;
        const nowIndex = hasChannel ? 2 : 1;
        const now = Number(args[nowIndex]);
        const limit = Number(args[args.length - 1]) || Infinity;
        const excluded = new Set(
          args.slice(nowIndex + 1, -1).map((value) => String(value))
        );
        return this.store.reticulumChatMessages
          .filter(
            (row) =>
              row.group_id === groupId &&
              (channelId == null || row.channel_id === channelId) &&
              row.deleted_at == null &&
              (row.expires_at == null || Number(row.expires_at) > now) &&
              !excluded.has(String(row.author_address))
          )
          .sort(
            (a, b) =>
              Number(b.created_at) - Number(a.created_at) ||
              String(b.root_event_id).localeCompare(String(a.root_event_id))
          )
          .slice(0, limit)
          .reverse();
      }
      if (
        this.sql.includes('deleted_at IS NULL') &&
        (this.sql.includes('created_at < ?') ||
          this.sql.includes('created_at > ?'))
      ) {
        const groupId = args[0];
        const hasChannel = this.sql.includes('channel_id = ?');
        const channelId = hasChannel ? args[1] : null;
        const nowIndex = hasChannel ? 2 : 1;
        const now = Number(args[nowIndex]);
        const cursorTimestamp = Number(args[nowIndex + 1]);
        const hasEventCursor =
          this.sql.includes('root_event_id < ?') ||
          this.sql.includes('root_event_id > ?');
        const cursorEventId = hasEventCursor ? String(args[nowIndex + 3]) : '';
        const excludedStart = nowIndex + (hasEventCursor ? 4 : 2);
        const excluded = new Set(
          args.slice(excludedStart, -1).map((value) => String(value))
        );
        const limit = Number(args[args.length - 1]) || Infinity;
        const isBefore = this.sql.includes('created_at < ?');
        const matchesCursor = (row: ReticulumChatRow) => {
          const timestamp = Number(row.created_at);
          if (isBefore) {
            return (
              timestamp < cursorTimestamp ||
              (hasEventCursor &&
                timestamp === cursorTimestamp &&
                String(row.root_event_id) < cursorEventId)
            );
          }
          return (
            timestamp > cursorTimestamp ||
            (hasEventCursor &&
              timestamp === cursorTimestamp &&
              String(row.root_event_id) > cursorEventId)
          );
        };
        const rows = this.store.reticulumChatMessages
          .filter(
            (row) =>
              row.group_id === groupId &&
              (channelId == null || row.channel_id === channelId) &&
              row.deleted_at == null &&
              (row.expires_at == null || Number(row.expires_at) > now) &&
              !excluded.has(String(row.author_address)) &&
              matchesCursor(row)
          )
          .sort((a, b) => {
            const order =
              Number(a.created_at) - Number(b.created_at) ||
              String(a.root_event_id).localeCompare(String(b.root_event_id));
            return isBefore ? -order : order;
          })
          .slice(0, limit);
        return isBefore && this.sql.includes('SELECT * FROM (')
          ? rows.reverse()
          : rows;
      }
      if (this.sql.includes('WHERE group_id = ? AND channel_id = ?')) {
        const [groupId, channelId, limit] = args;
        return this.store.reticulumChatMessages
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.channel_id === channelId &&
              row.deleted_at == null
          )
          .sort(
            (a, b) =>
              b.created_at - a.created_at ||
              String(b.root_event_id).localeCompare(String(a.root_event_id))
          )
          .slice(0, limit)
          .sort(
            (a, b) =>
              a.created_at - b.created_at ||
              String(a.root_event_id).localeCompare(String(b.root_event_id))
          );
      }
      if (this.sql.includes('WHERE group_id = ? AND deleted_at IS NULL')) {
        const [groupId, limit] = args;
        return this.store.reticulumChatMessages
          .filter((row) => row.group_id === groupId && row.deleted_at == null)
          .sort(
            (a, b) =>
              b.created_at - a.created_at ||
              String(b.root_event_id).localeCompare(String(a.root_event_id))
          )
          .slice(0, limit)
          .sort(
            (a, b) =>
              a.created_at - b.created_at ||
              String(a.root_event_id).localeCompare(String(b.root_event_id))
          );
      }
    }
    if (this.sql.includes('FROM rchat_expired_event_markers')) {
      if (this.sql.includes('GROUP BY author_address')) {
        const [groupId] = args;
        const byAuthor = new Map<string, number>();
        for (const row of this.store.reticulumChatExpiredEventMarkers) {
          if (row.group_id !== groupId) continue;
          const key = `${row.author_address}:${row.author_stream_id || ''}`;
          byAuthor.set(key, Math.max(byAuthor.get(key) ?? 0, row.author_seq));
        }
        return [...byAuthor.entries()].map(([key, seq]) => {
          const separator = key.lastIndexOf(':');
          return {
            author_address: key.slice(0, separator),
            author_stream_id: key.slice(separator + 1),
            seq,
          };
        });
      }
      return this.store.reticulumChatExpiredEventMarkers;
    }
    if (this.sql.includes('FROM reticulum_resource_chunks')) {
      const [fileHash] = args;
      return this.store.reticulumResourceChunks
        .filter((row) => row.file_hash === fileHash)
        .sort((a, b) => a.chunk_index - b.chunk_index);
    }
    if (this.sql.includes('FROM reticulum_resource_ranges')) {
      const [fileHash, overlapEnd, overlapStart] = args;
      return this.store.reticulumResourceRanges
        .filter(
          (row) =>
            row.file_hash === fileHash &&
            (!this.sql.includes("status = 'complete'") ||
              row.status === 'complete') &&
            (!this.sql.includes('start_byte <= ?') ||
              (Number(row.start_byte) <= Number(overlapEnd) &&
                Number(row.end_byte_exclusive) >= Number(overlapStart)))
        )
        .sort(
          (a, b) =>
            Number(a.start_byte) - Number(b.start_byte) ||
            Number(a.end_byte_exclusive) - Number(b.end_byte_exclusive)
        );
    }
    if (this.sql.includes('FROM reticulum_resource_group_refs')) {
      const [fileHash] = args;
      return this.store.reticulumResourceGroupRefs
        .filter((row) => row.file_hash === fileHash)
        .sort(
          (a, b) =>
            Number(a.group_id) - Number(b.group_id) ||
            String(a.event_id).localeCompare(String(b.event_id))
        );
    }
    if (
      this.sql.includes('FROM reticulum_resource_refs') &&
      !this.sql.includes('FROM reticulum_resources r')
    ) {
      const [fileHash] = args;
      return this.store.reticulumResourceRefs
        .filter((row) => row.file_hash === fileHash)
        .sort(
          (a, b) =>
            String(a.scope_type).localeCompare(String(b.scope_type)) ||
            String(a.scope_id).localeCompare(String(b.scope_id)) ||
            String(a.event_id).localeCompare(String(b.event_id))
        );
    }
    if (this.sql.includes('FROM reticulum_resources r')) {
      const [liveNow = 0, providerNow = 0, leaseNow = 0] = args;
      return this.store.reticulumResources
        .filter(
          (row) =>
            ['reticulum-group-resource', 'reticulum-dm-resource'].includes(
              String(row.namespace)
            ) ||
            this.store.reticulumResourceRefs.some(
              (ref) =>
                ref.file_hash === row.file_hash &&
                ['reticulum-group-resource', 'reticulum-dm-resource'].includes(
                  String(ref.namespace)
                )
            )
        )
        .map((row) => ({
          ...row,
          live_ref_count: this.store.reticulumResourceRefs.filter(
            (ref) =>
              ref.file_hash === row.file_hash &&
              (!this.sql.includes("event_id <> ''") || Boolean(ref.event_id)) &&
              ref.state === 'live' &&
              (ref.expires_at == null ||
                Number(ref.expires_at) > Number(liveNow))
          ).length,
          provider_count: new Set(
            this.store.reticulumResourceProviders
              .filter(
                (provider) =>
                  provider.file_hash === row.file_hash &&
                  Number(provider.retention_until) > Number(providerNow)
              )
              .map((provider) => provider.provider_id)
          ).size,
          active_lease_count: this.store.reticulumResourceLeases.filter(
            (lease) =>
              lease.file_hash === row.file_hash &&
              Number(lease.expires_at) > Number(leaseNow)
          ).length,
        }));
    }
    if (this.sql.includes('FROM reticulum_resources')) {
      if (this.sql.includes('WHERE file_hash > ?')) {
        const [afterFileHash = '', limit = Infinity] = args;
        return this.store.reticulumResources
          .filter((row) => String(row.file_hash) > String(afterFileHash))
          .sort((a, b) =>
            String(a.file_hash).localeCompare(String(b.file_hash))
          )
          .slice(0, Number(limit) || Infinity);
      }
      return [...this.store.reticulumResources];
    }
    if (this.sql.includes('FROM reticulum_chat_events')) {
      if (this.sql.includes('privileged_mention_status = 2')) {
        const limit = Number(args[0]) || Infinity;
        return this.store.reticulumChatEvents
          .filter((row) => row.privileged_mention_status === 2)
          .sort(
            (a, b) => Number(a.accepted_at || 0) - Number(b.accepted_at || 0)
          )
          .slice(0, limit);
      }
      if (
        this.sql.includes("event_type IN ('message', 'attachment_manifest')") &&
        this.sql.includes('timestamp > ?')
      ) {
        const [
          groupId,
          channelId,
          afterTimestamp,
          _sameAfterTimestamp,
          afterEventId,
          limit = Infinity,
        ] = args;
        return this.store.reticulumChatEvents
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.channel_id === channelId &&
              ['message', 'attachment_manifest'].includes(
                String(row.event_type)
              ) &&
              (Number(row.timestamp) > Number(afterTimestamp) ||
                (Number(row.timestamp) === Number(afterTimestamp) &&
                  String(row.event_id) > String(afterEventId)))
          )
          .sort(
            (a, b) =>
              Number(a.timestamp) - Number(b.timestamp) ||
              String(a.event_id).localeCompare(String(b.event_id))
          )
          .slice(0, Number(limit) || Infinity)
          .map((row) => ({
            event_id: row.event_id,
            timestamp: row.timestamp,
            encrypted_payload: row.encrypted_payload,
            expires_at: row.expires_at ?? null,
            message_expiry_duration_ms: row.message_expiry_duration_ms ?? null,
          }));
      }
      if (this.sql.includes('WHERE event_id = ? OR target_event_id = ?')) {
        const [eventId, targetEventId] = args;
        return this.store.reticulumChatEvents
          .filter(
            (row) =>
              row.event_id === eventId || row.target_event_id === targetEventId
          )
          .sort(
            (a, b) =>
              (a.feed_timestamp ?? a.timestamp) -
                (b.feed_timestamp ?? b.timestamp) ||
              String(a.event_id).localeCompare(String(b.event_id))
          );
      }
      if (
        this.sql.includes(
          'WHERE group_id = ? AND author_address = ? AND author_stream_id = ? AND author_seq > ?'
        )
      ) {
        const [groupId, authorAddress, authorStreamId, seq, limit] = args;
        return this.store.reticulumChatEvents
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.author_address === authorAddress &&
              String(row.author_stream_id || '') === authorStreamId &&
              row.author_seq > seq
          )
          .sort((a, b) => a.author_seq - b.author_seq)
          .slice(0, limit);
      }
      if (this.sql.includes('e.author_seq AS max_seq')) {
        const [groupId, _sameGroupId, limit] = args;
        const byAuthor = new Map<string, any>();
        for (const row of [
          ...this.store.reticulumChatEvents,
          ...this.store.reticulumChatExpiredEventMarkers,
        ]) {
          if (row.group_id !== groupId) continue;
          const key = `${row.author_address}:${row.author_stream_id || ''}`;
          const existing = byAuthor.get(key);
          if (existing && existing.author_seq >= row.author_seq) continue;
          byAuthor.set(key, row);
        }
        return [...byAuthor.values()]
          .sort(
            (a, b) =>
              b.timestamp - a.timestamp ||
              String(b.event_id).localeCompare(String(a.event_id))
          )
          .slice(0, limit)
          .map((row) => ({
            author_address: row.author_address,
            author_stream_id: row.author_stream_id || '',
            max_seq: row.author_seq,
            event_id: row.event_id,
            timestamp: row.timestamp,
          }));
      }
      if (this.sql.includes('author_seq > ?')) {
        const [groupId, authorAddress, afterSeq, limit] = args;
        return this.store.reticulumChatEvents
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.author_address === authorAddress &&
              row.author_seq > afterSeq
          )
          .sort(
            (a, b) =>
              a.author_seq - b.author_seq ||
              a.timestamp - b.timestamp ||
              String(a.event_id).localeCompare(String(b.event_id))
          )
          .slice(0, limit);
      }
      if (this.sql.includes('GROUP BY author_address')) {
        const [groupId] = args;
        const byAuthor = new Map<string, number>();
        for (const row of [
          ...this.store.reticulumChatEvents,
          ...this.store.reticulumChatExpiredEventMarkers,
        ]) {
          if (row.group_id !== groupId) continue;
          const key = `${row.author_address}:${row.author_stream_id || ''}`;
          byAuthor.set(key, Math.max(byAuthor.get(key) ?? 0, row.author_seq));
        }
        return [...byAuthor.entries()].map(([key, seq]) => {
          const separator = key.lastIndexOf(':');
          return {
            author_address: key.slice(0, separator),
            author_stream_id: key.slice(separator + 1),
            seq,
          };
        });
      }
      if (
        this.sql.includes('timestamp > ? OR (timestamp = ? AND event_id > ?)')
      ) {
        const [groupId, timestamp, _sameTimestamp, eventId, limit] = args;
        return this.store.reticulumChatEvents
          .filter((row) => {
            if (row.group_id !== groupId) return false;
            if (row.timestamp > timestamp) return true;
            return (
              row.timestamp === timestamp &&
              String(row.event_id) > String(eventId)
            );
          })
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp ||
              String(a.event_id).localeCompare(String(b.event_id))
          )
          .slice(0, limit);
      }
      if (this.sql.includes('timestamp >= ?')) {
        const [groupId, timestamp, limit] = args;
        return this.store.reticulumChatEvents
          .filter(
            (row) => row.group_id === groupId && row.timestamp >= timestamp
          )
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp ||
              String(a.event_id).localeCompare(String(b.event_id))
          )
          .slice(0, limit);
      }
      if (this.sql.includes('timestamp < ?')) {
        const hasCursor = this.sql.includes('event_id < ?');
        const [
          groupId,
          timestamp,
          _sameTimestampOrLimit,
          eventIdOrUndefined,
          maybeLimit,
        ] = args;
        const eventId = hasCursor ? String(eventIdOrUndefined) : '';
        const limit = hasCursor ? maybeLimit : _sameTimestampOrLimit;
        return this.store.reticulumChatEvents
          .filter((row) => {
            if (row.group_id !== groupId) return false;
            if (!hasCursor) return row.timestamp < timestamp;
            if (row.timestamp < timestamp) return true;
            return (
              row.timestamp === timestamp && String(row.event_id) < eventId
            );
          })
          .sort(
            (a, b) =>
              b.timestamp - a.timestamp ||
              String(b.event_id).localeCompare(String(a.event_id))
          )
          .slice(0, limit)
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp ||
              String(a.event_id).localeCompare(String(b.event_id))
          );
      }
      if (this.sql.includes('WHERE group_id = ?')) {
        const [groupId, limit] = args;
        return this.store.reticulumChatEvents
          .filter((row) => row.group_id === groupId)
          .sort(
            (a, b) =>
              b.timestamp - a.timestamp ||
              String(b.event_id).localeCompare(String(a.event_id))
          )
          .slice(0, limit)
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp ||
              String(a.event_id).localeCompare(String(b.event_id))
          );
      }
    }
    return [];
  }

  get(...args: any[]) {
    if (this.sql.includes('FROM rchat_rejected_digest_markers')) {
      const [groupId, digestFingerprint] = args;
      const row = this.store.reticulumChatRejectedDigestMarkers.find(
        (candidate) =>
          candidate.group_id === groupId &&
          candidate.digest_fingerprint === digestFingerprint
      );
      return row ? { 1: 1 } : undefined;
    }
    if (this.sql.includes('FROM rchat_rejected_event_markers')) {
      const [groupId, eventId] = args;
      return this.store.reticulumChatRejectedEventMarkers.find(
        (row) => row.group_id === groupId && row.event_id === eventId
      );
    }
    if (
      this.sql.includes('FROM rchat_calendar_events e') &&
      this.sql.includes('JOIN rchat_calendar_mutations m')
    ) {
      const [groupId, eventId] = args;
      const event = this.store.reticulumCalendarEvents.find(
        (item) => item.group_id === groupId && item.event_id === eventId
      );
      if (!event) return undefined;
      const mutation = this.store.reticulumCalendarMutations.find(
        (item) => item.mutation_id === event.mutation_id
      );
      return mutation ? { mutation_json: mutation.mutation_json } : undefined;
    }
    if (
      this.sql.includes('FROM rchat_calendar_mutations') &&
      this.sql.includes("operation = 'upsert'") &&
      this.sql.includes('ORDER BY timestamp ASC')
    ) {
      const [groupId, eventId] = args;
      const row = this.store.reticulumCalendarMutations
        .filter(
          (item) =>
            item.group_id === groupId &&
            item.event_id === eventId &&
            item.operation === 'upsert'
        )
        .sort(
          (left, right) =>
            Number(left.timestamp) - Number(right.timestamp) ||
            String(left.mutation_id).localeCompare(String(right.mutation_id))
        )[0];
      return row
        ? { author_address: row.author_address, timestamp: row.timestamp }
        : undefined;
    }
    if (this.sql.includes('FROM rchat_calendar_mutations')) {
      const row = this.store.reticulumCalendarMutations.find(
        (item) => item.mutation_id === args[0]
      );
      return this.sql.includes('SELECT 1') && row ? { 1: 1 } : row;
    }
    if (this.sql.includes('FROM rchat_calendar_events')) {
      const [groupId, eventId] = args;
      const row = this.store.reticulumCalendarEvents.find(
        (item) =>
          item.group_id === groupId &&
          item.event_id === eventId &&
          (!this.sql.includes('deleted = 0') || Number(item.deleted) === 0)
      );
      return this.sql.includes('SELECT 1') && row ? { 1: 1 } : row;
    }
    if (this.sql.includes('FROM rchat_direct_call_history')) {
      const [ownerAddress, callId] = args;
      return this.store.reticulumDirectCallHistory.find(
        (row) => row.owner_address === ownerAddress && row.call_id === callId
      );
    }
    if (this.sql.includes('FROM rchat_dm_expiry_preferences')) {
      const [ownerAddress, peerAddress] = args;
      return this.store.reticulumDmExpiryPreferences.find(
        (row) =>
          row.owner_address === ownerAddress && row.peer_address === peerAddress
      );
    }
    if (
      this.sql.includes('FROM (') &&
      this.sql.includes('FROM rchat_dm_expired_event_markers')
    ) {
      const [conversationId, senderAddress] = args;
      const rows = [
        ...this.store.reticulumDmEvents,
        ...this.store.reticulumDmExpiredEventMarkers,
      ]
        .filter(
          (row) =>
            row.conversation_id === conversationId &&
            row.sender_address === senderAddress
        )
        .sort(
          (a, b) =>
            Number(b.timestamp) - Number(a.timestamp) ||
            String(b.event_id).localeCompare(String(a.event_id))
        );
      if (this.sql.includes('MAX(sender_seq) AS max_seq')) {
        return {
          max_seq: rows.reduce(
            (highest, row) => Math.max(highest, Number(row.sender_seq) || 0),
            0
          ),
        };
      }
      return rows[0];
    }
    if (this.sql.includes('FROM rchat_dm_expired_event_markers')) {
      const row = this.store.reticulumDmExpiredEventMarkers.find(
        (item) => item.event_id === args[0]
      );
      return this.sql.includes('SELECT 1') && row ? { 1: 1 } : row;
    }
    if (this.sql.includes('FROM rchat_device_read_state')) {
      const [ownerAddress, scopeType, scopeId] = args;
      return this.store.reticulumDeviceReadStates.find(
        (row) =>
          row.owner_address === ownerAddress &&
          row.scope_type === scopeType &&
          row.scope_id === scopeId
      );
    }
    if (this.sql.includes('FROM rchat_dm_read_watermarks')) {
      const [conversationId, address] = args;
      return this.store.reticulumDmReadWatermarks.find(
        (row) =>
          row.conversation_id === conversationId && row.address === address
      );
    }
    if (this.sql.includes('FROM rchat_missing_range_peer_observations')) {
      const [
        groupId,
        authorAddress,
        authorStreamId,
        queryFromSeq,
        queryToSeq,
        peerOrObservedAfter,
      ] = args;
      const matching =
        this.store.reticulumChatMissingRangePeerObservations.filter(
          (row) =>
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            row.author_stream_id === authorStreamId &&
            row.from_seq <= queryFromSeq &&
            row.to_seq >= queryToSeq
        );
      if (this.sql.includes('COUNT(DISTINCT peer_hash)')) {
        const peers = new Set(
          matching
            .filter(
              (row) =>
                Number(row.observed_at) >= Number(peerOrObservedAfter || 0)
            )
            .map((row) => String(row.peer_hash))
        );
        return { count: peers.size };
      }
      const peerHash = peerOrObservedAfter;
      const peerMatches = matching.filter((row) => row.peer_hash === peerHash);
      if (!this.sql.includes('MAX(observed_at)')) return peerMatches[0];
      const newest = peerMatches.reduce<ReticulumChatRow | undefined>(
        (current, row) =>
          !current || Number(row.observed_at) > Number(current.observed_at)
            ? row
            : current,
        undefined
      );
      return newest ? { observed_at: newest.observed_at } : undefined;
    }
    if (this.sql.includes('FROM rchat_known_unavailable_ranges')) {
      const [groupId, authorAddress, authorStreamId, fromSeq, toSeq] = args;
      return this.store.reticulumChatKnownUnavailableRanges.find(
        (row) =>
          row.group_id === groupId &&
          row.author_address === authorAddress &&
          row.author_stream_id === authorStreamId &&
          row.from_seq === fromSeq &&
          row.to_seq === toSeq
      );
    }
    if (
      this.sql.includes('FROM rchat_silences') &&
      !this.sql.includes('FROM rchat_dm_events')
    ) {
      const [ownerAddress, targetAddress, scopeType, scopeId] = args;
      return this.store.reticulumChatSilences.find(
        (row) =>
          row.owner_address === ownerAddress &&
          row.target_address === targetAddress &&
          row.scope_type === scopeType &&
          row.scope_id === scopeId
      );
    }
    if (this.sql.includes('FROM rchat_dm_events')) {
      if (this.sql.includes('SELECT MIN(expires_at) AS expires_at')) {
        const expiries = this.store.reticulumDmEvents
          .map((row) => Number(row.expires_at))
          .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > 0);
        return {
          expires_at: expiries.length > 0 ? Math.min(...expiries) : null,
        };
      }
      if (this.sql.includes('COUNT(*) AS count')) {
        const [
          conversationId,
          recipientAddress,
          senderAddress,
          expiryNow,
          ownerAddress,
          silenceNow,
        ] = args;
        return {
          count: this.store.reticulumDmEvents.filter((row) => {
            if (
              row.conversation_id !== conversationId ||
              row.recipient_address !== recipientAddress ||
              row.sender_address === senderAddress ||
              (this.sql.includes("event_type = 'message'") &&
                row.event_type !== 'message') ||
              Number(row.read_at) !== 0
            ) {
              return false;
            }
            if (
              row.expires_at != null &&
              Number(row.expires_at) <= Number(expiryNow)
            ) {
              return false;
            }
            return !this.store.reticulumChatSilences.some(
              (silence) =>
                silence.owner_address === ownerAddress &&
                silence.target_address === row.sender_address &&
                silence.scope_type === 'dm' &&
                silence.scope_id === row.conversation_id &&
                (silence.expires_at == null ||
                  Number(silence.expires_at) > Number(silenceNow) ||
                  Number(row.timestamp) <= Number(silence.ignored_through))
            );
          }).length,
        };
      }
      if (this.sql.includes('WHERE event_id = ?')) {
        const row = this.store.reticulumDmEvents.find(
          (item) => item.event_id === args[0]
        );
        return this.sql.includes('SELECT 1') && row ? { 1: 1 } : row;
      }
    }
    if (
      this.sql.includes('FROM rchat_message_projection p') &&
      this.sql.includes('p.root_event_id = ?')
    ) {
      const [groupId, channelId, rootEventId, now, ...excludedAuthors] = args;
      const channel = this.store.reticulumChatChannels.find(
        (row) => row.group_id === groupId && row.channel_id === channelId
      );
      if (
        this.sql.includes("c.read_mode != 'admins'") &&
        channel?.read_mode === 'admins'
      ) {
        return undefined;
      }
      const excluded = new Set(excludedAuthors.map(String));
      return this.store.reticulumChatMessages.find(
        (row) =>
          row.group_id === groupId &&
          row.channel_id === channelId &&
          row.root_event_id === rootEventId &&
          row.deleted_at == null &&
          (row.expires_at == null || Number(row.expires_at) > Number(now)) &&
          !excluded.has(String(row.author_address))
      );
    }
    if (
      this.sql.includes('SELECT author_seq FROM rchat_author_sequence_leases')
    ) {
      const [groupId, authorAddress, authorStreamId, ownerId] = args;
      return this.store.reticulumChatAuthorSequenceLeases.find(
        (row) =>
          row.group_id === groupId &&
          row.author_address === authorAddress &&
          row.author_stream_id === authorStreamId &&
          (!this.sql.includes('owner_id = ?') || row.owner_id === ownerId)
      );
    }
    if (this.sql.includes('COALESCE(MAX(author_seq), 0) AS max_seq')) {
      const [groupId, authorAddress, authorStreamId] = args;
      const rows = this.sql.includes('FROM rchat_event_headers')
        ? this.store.reticulumChatEventHeaders
        : this.sql.includes('FROM rchat_author_sequence_leases')
          ? this.store.reticulumChatAuthorSequenceLeases
          : this.store.reticulumChatExpiredEventMarkers;
      return {
        max_seq: rows
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.author_address === authorAddress &&
              row.author_stream_id === authorStreamId
          )
          .reduce((max, row) => Math.max(max, Number(row.author_seq) || 0), 0),
      };
    }
    if (
      this.sql.includes('SELECT MAX(author_seq) AS seq') &&
      this.sql.includes('FROM rchat_event_headers')
    ) {
      const [groupId, authorAddress, authorStreamId] = args;
      const seq = [
        ...this.store.reticulumChatEventHeaders,
        ...this.store.reticulumChatExpiredEventMarkers,
      ]
        .filter(
          (row) =>
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            String(row.author_stream_id || '') === String(authorStreamId || '')
        )
        .reduce((max, row) => Math.max(max, Number(row.author_seq) || 0), 0);
      return { seq };
    }
    if (this.sql.includes('SELECT stream_id FROM rchat_author_streams')) {
      const streamId = this.store.reticulumChatAuthorStreams.get(
        String(args[0] || '')
      );
      return streamId ? { stream_id: streamId } : undefined;
    }
    if (this.sql.includes('FROM rchat_metadata_snapshots')) {
      const [groupId, value] = args;
      return this.store.reticulumChatMetadataSnapshots
        .filter((row) => {
          if (row.group_id !== groupId) return false;
          if (this.sql.includes('snapshot_hash = ?'))
            return row.snapshot_hash === value;
          if (this.sql.includes('scope = ?')) return row.scope === value;
          return true;
        })
        .sort(
          (a, b) =>
            b.version - a.version ||
            b.created_at - a.created_at ||
            String(b.snapshot_hash).localeCompare(String(a.snapshot_hash))
        )[0];
    }
    if (this.sql.includes('FROM rchat_metadata_entity_revisions')) {
      const [groupId, entityType, entityId] = args;
      return this.store.reticulumChatMetadataEntityRevisions.find(
        (row) =>
          row.group_id === groupId &&
          row.entity_type === entityType &&
          row.entity_id === entityId
      );
    }
    if (this.sql.includes('FROM rchat_message_projection')) {
      if (this.sql.includes('SELECT current_event_id AS event_id')) {
        const row = this.store.reticulumChatMessages.find(
          (message) => message.root_event_id === args[0]
        );
        return row ? { event_id: row.current_event_id } : undefined;
      }
      if (this.sql.includes('COUNT(*) AS cnt')) {
        return { cnt: this.store.reticulumChatMessages.length };
      }
    }
    if (this.sql.includes('FROM reticulum_resource_meta')) {
      const [key] = args;
      const value = this.store.reticulumResourceMeta.get(String(key));
      return value == null ? undefined : { value };
    }
    if (
      this.sql.includes('SELECT 1 AS present') &&
      this.sql.includes('FROM reticulum_resources')
    ) {
      return this.store.reticulumResources.length > 0
        ? { present: 1 }
        : undefined;
    }
    if (this.sql.includes('FROM reticulum_resources r')) {
      const [liveNow = 0, providerNow = 0, leaseNow = 0, fileHash] = args;
      const row = this.store.reticulumResources.find(
        (item) => item.file_hash === fileHash
      );
      if (!row) return undefined;
      return {
        ...row,
        live_ref_count: this.store.reticulumResourceRefs.filter(
          (ref) =>
            ref.file_hash === row.file_hash &&
            (!this.sql.includes("event_id <> ''") || Boolean(ref.event_id)) &&
            ref.state === 'live' &&
            (ref.expires_at == null || Number(ref.expires_at) > Number(liveNow))
        ).length,
        provider_count: new Set(
          this.store.reticulumResourceProviders
            .filter(
              (provider) =>
                provider.file_hash === row.file_hash &&
                Number(provider.retention_until) > Number(providerNow)
            )
            .map((provider) => provider.provider_id)
        ).size,
        active_lease_count: this.store.reticulumResourceLeases.filter(
          (lease) =>
            lease.file_hash === row.file_hash &&
            Number(lease.expires_at) > Number(leaseNow)
        ).length,
      };
    }
    if (this.sql.includes('FROM reticulum_resources')) {
      const [fileHash] = args;
      const row = this.store.reticulumResources.find(
        (item) => item.file_hash === fileHash
      );
      if (!row) return undefined;
      if (this.sql.includes('SELECT provenance'))
        return { provenance: row.provenance };
      return row;
    }
    if (this.sql.includes('FROM reticulum_resource_group_refs')) {
      const [fileHash, groupId] = args;
      const row = this.store.reticulumResourceGroupRefs.find(
        (item) => item.file_hash === fileHash && item.group_id === groupId
      );
      return row ? { 1: 1 } : undefined;
    }
    if (this.sql.includes('FROM reticulum_resource_refs')) {
      const [fileHash, scopeType, scopeId] = args;
      const hasEventPredicate = this.sql.includes('event_id = ?');
      const eventBeforeExpiry =
        hasEventPredicate &&
        this.sql.indexOf('event_id = ?') < this.sql.indexOf('expires_at');
      const eventId = hasEventPredicate
        ? args[eventBeforeExpiry ? 3 : 4]
        : undefined;
      const expiryNow = this.sql.includes('expires_at')
        ? args[hasEventPredicate && eventBeforeExpiry ? 4 : 3]
        : undefined;
      const rows = this.store.reticulumResourceRefs
        .filter(
          (row) =>
            row.file_hash === fileHash &&
            row.scope_type === scopeType &&
            row.scope_id === scopeId &&
            (!this.sql.includes("event_id <> ''") || Boolean(row.event_id)) &&
            (!this.sql.includes('event_id = ?') || row.event_id === eventId) &&
            (!this.sql.includes("state = 'live'") || row.state === 'live') &&
            (expiryNow == null ||
              row.expires_at == null ||
              Number(row.expires_at) > Number(expiryNow))
        )
        .sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
      if (rows.length === 0) return undefined;
      return this.sql.includes('SELECT 1') ? { 1: 1 } : rows[0];
    }
    if (this.sql.includes('FROM reticulum_resource_providers')) {
      const [fileHash, now] = args;
      return {
        count: new Set(
          this.store.reticulumResourceProviders
            .filter(
              (row) =>
                row.file_hash === fileHash &&
                Number(row.retention_until) > Number(now)
            )
            .map((row) => row.provider_id)
        ).size,
      };
    }
    if (this.sql.includes('FROM reticulum_resource_reservations')) {
      const [now] = args;
      return {
        bytes: this.store.reticulumResourceReservations
          .filter((row) => Number(row.expires_at) > Number(now))
          .reduce((total, row) => total + Number(row.size_bytes || 0), 0),
      };
    }
    if (
      this.sql.includes('MAX(updated_at) AS updated_at') &&
      this.sql.includes('FROM reticulum_resource_ranges')
    ) {
      const [fileHash] = args;
      const updatedAt = this.store.reticulumResourceRanges
        .filter(
          (row) => row.file_hash === fileHash && row.status === 'complete'
        )
        .reduce<
          number | null
        >((latest, row) => (latest == null ? Number(row.updated_at) : Math.max(latest, Number(row.updated_at))), null);
      return { updated_at: updatedAt };
    }
    if (this.sql.includes('FROM reticulum_resource_chunks')) {
      if (this.sql.includes('COUNT(*) AS count')) {
        const [fileHash] = args;
        return {
          count: this.store.reticulumResourceChunks.filter(
            (row) => row.file_hash === fileHash && row.status !== 'complete'
          ).length,
        };
      }
      const [fileHash, chunkIndex] = args;
      return this.store.reticulumResourceChunks.find(
        (row) => row.file_hash === fileHash && row.chunk_index === chunkIndex
      );
    }
    if (this.sql.includes('FROM rchat_expired_event_markers')) {
      if (this.sql.includes('MAX(author_seq) AS seq')) {
        const [groupId, authorAddress, authorStreamId] = args;
        let seq = 0;
        for (const row of this.store.reticulumChatExpiredEventMarkers) {
          if (
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            String(row.author_stream_id || '') === String(authorStreamId || '')
          ) {
            seq = Math.max(seq, Number(row.author_seq) || 0);
          }
        }
        return { seq };
      }
      if (this.sql.includes('WHERE event_id = ?')) {
        const [eventId] = args;
        return this.store.reticulumChatExpiredEventMarkers.find(
          (row) => row.event_id === eventId
        );
      }
    }
    if (this.sql.includes('FROM rchat_schema_migrations')) {
      const [name] = args;
      const appliedAt = this.store.reticulumChatSchemaMigrations.get(
        String(name)
      );
      return appliedAt === undefined
        ? undefined
        : { 1: 1, applied_at: appliedAt };
    }
    if (this.sql.includes('FROM rchat_channel_expiry_reconciliation')) {
      const [groupId, channelId] = args;
      return this.store.reticulumChatChannelExpiryReconciliations.find(
        (row) => row.group_id === groupId && row.channel_id === channelId
      );
    }
    if (this.sql.includes('FROM reticulum_chat_channels')) {
      const [groupId, channelId] = args;
      return this.store.reticulumChatChannels.find(
        (row) => row.group_id === groupId && row.channel_id === channelId
      );
    }
    if (this.sql.includes('FROM reticulum_chat_events')) {
      if (this.sql.includes('SELECT MIN(expires_at) AS expires_at')) {
        const [groupId, channelId, now] = args;
        const expiries = this.store.reticulumChatEvents
          .filter(
            (row) =>
              row.group_id === groupId &&
              row.channel_id === channelId &&
              ['message', 'attachment_manifest'].includes(
                String(row.event_type)
              ) &&
              row.expires_at != null &&
              Number(row.expires_at) > Number(now)
          )
          .map((row) => Number(row.expires_at));
        return {
          expires_at: expiries.length > 0 ? Math.min(...expiries) : null,
        };
      }
      if (this.sql.includes('WHERE event_id = ?')) {
        const [eventId] = args;
        const row = this.store.reticulumChatEvents.find(
          (item) => item.event_id === eventId
        );
        if (!row) return undefined;
        if (this.sql.includes('privileged_mention_status AS status')) {
          return { status: Number(row.privileged_mention_status || 0) };
        }
        return this.sql.includes('SELECT 1') ? { 1: 1 } : row;
      }
      if (this.sql.includes('MAX(author_seq) AS seq')) {
        const [
          groupId,
          authorAddress,
          authorStreamId,
          markerGroupId,
          markerAuthorAddress,
          markerStreamId,
        ] = args;
        let seq = 0;
        for (const row of [
          ...this.store.reticulumChatEvents,
          ...this.store.reticulumChatExpiredEventMarkers,
        ]) {
          if (
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            String(row.author_stream_id || '') === authorStreamId
          ) {
            seq = Math.max(seq, Number(row.author_seq) || 0);
          }
          if (
            row.group_id === markerGroupId &&
            row.author_address === markerAuthorAddress &&
            String(row.author_stream_id || '') === markerStreamId
          ) {
            seq = Math.max(seq, Number(row.author_seq) || 0);
          }
        }
        return { seq };
      }
      if (this.sql.includes('SUM(wire_bytes)')) {
        return {
          total: this.store.reticulumChatEvents
            .filter((row) => row.own_event === 0)
            .reduce((sum, row) => sum + row.wire_bytes, 0),
        };
      }
      if (this.sql.includes('WHERE own_event = 0')) {
        return this.store.reticulumChatEvents
          .filter((row) => row.own_event === 0)
          .sort(
            (a, b) =>
              a.last_served_at - b.last_served_at ||
              a.timestamp - b.timestamp ||
              a.stored_at - b.stored_at
          )
          .map((row) => ({ event_id: row.event_id }))[0];
      }
    }
    return undefined;
  }

  run(...args: any[]) {
    if (
      this.sql.includes('UPDATE rchat_rejected_event_markers') &&
      this.sql.includes('SET next_revalidate_at = rejected_at + ?')
    ) {
      const retentionMs = Number(args[0]);
      let changes = 0;
      for (const row of this.store.reticulumChatRejectedEventMarkers) {
        const retainUntil = Number(row.rejected_at) + retentionMs;
        if (Number(row.next_revalidate_at) >= retainUntil) continue;
        row.next_revalidate_at = retainUntil;
        changes += 1;
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE rchat_rejected_digest_markers') &&
      this.sql.includes('SELECT events.next_revalidate_at')
    ) {
      let changes = 0;
      for (const row of this.store.reticulumChatRejectedDigestMarkers) {
        const event = this.store.reticulumChatRejectedEventMarkers.find(
          (candidate) =>
            candidate.group_id === row.group_id &&
            candidate.event_id === row.event_id
        );
        if (
          !event ||
          Number(row.next_revalidate_at) >= Number(event.next_revalidate_at)
        ) {
          continue;
        }
        row.next_revalidate_at = event.next_revalidate_at;
        changes += 1;
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO rchat_rejected_digest_markers')) {
      const [
        groupId,
        eventId,
        eventFingerprint,
        digestFingerprint,
        rejectedAt,
        nextRevalidateAt,
      ] = args;
      const row = {
        group_id: groupId,
        event_id: eventId,
        event_fingerprint: eventFingerprint,
        digest_fingerprint: digestFingerprint,
        rejected_at: rejectedAt,
        next_revalidate_at: nextRevalidateAt,
      };
      const index = this.store.reticulumChatRejectedDigestMarkers.findIndex(
        (candidate) =>
          candidate.group_id === groupId &&
          candidate.event_id === eventId &&
          candidate.digest_fingerprint === digestFingerprint
      );
      if (index >= 0) {
        this.store.reticulumChatRejectedDigestMarkers[index] = row;
      } else {
        this.store.reticulumChatRejectedDigestMarkers.push(row);
      }
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0
            ? index + 1
            : this.store.reticulumChatRejectedDigestMarkers.length,
      };
    }
    if (this.sql.includes('DELETE FROM rchat_rejected_digest_markers')) {
      const before = this.store.reticulumChatRejectedDigestMarkers.length;
      if (this.sql.includes('WHERE group_id = ? AND event_id = ?')) {
        const [groupId, eventId] = args;
        this.store.reticulumChatRejectedDigestMarkers =
          this.store.reticulumChatRejectedDigestMarkers.filter(
            (row) => row.group_id !== groupId || row.event_id !== eventId
          );
      } else if (this.sql.includes('WHERE NOT EXISTS')) {
        this.store.reticulumChatRejectedDigestMarkers =
          this.store.reticulumChatRejectedDigestMarkers.filter((row) =>
            this.store.reticulumChatRejectedEventMarkers.some(
              (event) =>
                event.group_id === row.group_id &&
                event.event_id === row.event_id
            )
          );
      } else if (this.sql.includes('WHERE rowid NOT IN')) {
        const limit = Math.max(1, Number(args[0]) || 1);
        this.store.reticulumChatRejectedDigestMarkers = [
          ...this.store.reticulumChatRejectedDigestMarkers,
        ]
          .sort(
            (left, right) =>
              Number(right.rejected_at) - Number(left.rejected_at) ||
              Number(right.group_id) - Number(left.group_id) ||
              String(right.event_id).localeCompare(String(left.event_id)) ||
              String(right.digest_fingerprint).localeCompare(
                String(left.digest_fingerprint)
              )
          )
          .slice(0, limit);
      }
      return {
        changes: before - this.store.reticulumChatRejectedDigestMarkers.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_rejected_event_markers')) {
      const [
        groupId,
        eventId,
        eventFingerprint,
        authorAddress,
        authorStreamId,
        authorSeq,
        digestFingerprint,
        rejectedAt,
        nextRevalidateAt,
        revalidationAttempts,
      ] = args;
      const row = {
        group_id: groupId,
        event_id: eventId,
        event_fingerprint: eventFingerprint,
        author_address: authorAddress,
        author_stream_id: authorStreamId,
        author_seq: authorSeq,
        digest_fingerprint: digestFingerprint,
        rejected_at: rejectedAt,
        next_revalidate_at: nextRevalidateAt,
        revalidation_attempts: revalidationAttempts,
      };
      const index = this.store.reticulumChatRejectedEventMarkers.findIndex(
        (candidate) =>
          candidate.group_id === groupId && candidate.event_id === eventId
      );
      if (index >= 0) this.store.reticulumChatRejectedEventMarkers[index] = row;
      else this.store.reticulumChatRejectedEventMarkers.push(row);
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0
            ? index + 1
            : this.store.reticulumChatRejectedEventMarkers.length,
      };
    }
    if (this.sql.includes('DELETE FROM rchat_rejected_event_markers')) {
      const before = this.store.reticulumChatRejectedEventMarkers.length;
      if (this.sql.includes('WHERE group_id = ? AND event_id = ?')) {
        const [groupId, eventId] = args;
        this.store.reticulumChatRejectedEventMarkers =
          this.store.reticulumChatRejectedEventMarkers.filter(
            (row) => row.group_id !== groupId || row.event_id !== eventId
          );
      } else if (this.sql.includes('WHERE rejected_at <= ?')) {
        const cutoff = Number(args[0]);
        this.store.reticulumChatRejectedEventMarkers =
          this.store.reticulumChatRejectedEventMarkers.filter(
            (row) => Number(row.rejected_at) > cutoff
          );
      } else if (this.sql.includes('WHERE next_revalidate_at <= ?')) {
        const cutoff = Number(args[0]);
        this.store.reticulumChatRejectedEventMarkers =
          this.store.reticulumChatRejectedEventMarkers.filter(
            (row) => Number(row.next_revalidate_at) > cutoff
          );
      } else if (this.sql.includes('WHERE rowid NOT IN')) {
        const limit = Math.max(1, Number(args[0]) || 1);
        this.store.reticulumChatRejectedEventMarkers = [
          ...this.store.reticulumChatRejectedEventMarkers,
        ]
          .sort(
            (left, right) =>
              Number(right.rejected_at) - Number(left.rejected_at) ||
              Number(right.group_id) - Number(left.group_id) ||
              String(right.event_id).localeCompare(String(left.event_id))
          )
          .slice(0, limit);
      }
      return {
        changes: before - this.store.reticulumChatRejectedEventMarkers.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_calendar_mutations')) {
      const [
        mutationId,
        groupId,
        eventId,
        operation,
        timestamp,
        authorAddress,
        authorPublicKey,
        signature,
        resourceHash,
        mutationJson,
        storedAt,
      ] = args;
      if (
        this.store.reticulumCalendarMutations.some(
          (row) => row.mutation_id === mutationId
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumCalendarMutations.push({
        mutation_id: mutationId,
        group_id: groupId,
        event_id: eventId,
        operation,
        timestamp,
        author_address: authorAddress,
        author_public_key: authorPublicKey,
        signature,
        resource_hash: resourceHash,
        mutation_json: mutationJson,
        stored_at: storedAt,
      });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumCalendarMutations.length,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_calendar_events')) {
      const [
        groupId,
        eventId,
        mutationId,
        updatedAt,
        deleted,
        stateJson,
        startAt,
        endAt,
        recurring,
        recurrenceUntilAt,
      ] = args;
      const row = {
        group_id: groupId,
        event_id: eventId,
        mutation_id: mutationId,
        updated_at: updatedAt,
        deleted,
        state_json: stateJson,
        start_at: startAt,
        end_at: endAt,
        recurring,
        recurrence_until_at: recurrenceUntilAt,
      };
      const index = this.store.reticulumCalendarEvents.findIndex(
        (candidate) =>
          candidate.group_id === groupId && candidate.event_id === eventId
      );
      if (index >= 0) this.store.reticulumCalendarEvents[index] = row;
      else this.store.reticulumCalendarEvents.push(row);
      return { changes: 1, lastInsertRowid: Math.max(1, index + 1) };
    }
    if (this.sql.includes('DELETE FROM rchat_calendar_reminders')) {
      const [groupId, eventId] = args;
      const before = this.store.reticulumCalendarReminders.length;
      this.store.reticulumCalendarReminders =
        this.store.reticulumCalendarReminders.filter(
          (row) => row.group_id !== groupId || row.event_id !== eventId
        );
      return {
        changes: before - this.store.reticulumCalendarReminders.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_dm_expiry_preferences')) {
      const [ownerAddress, peerAddress, durationMs, updatedAt] = args;
      const index = this.store.reticulumDmExpiryPreferences.findIndex(
        (row) =>
          row.owner_address === ownerAddress && row.peer_address === peerAddress
      );
      const row = {
        owner_address: ownerAddress,
        peer_address: peerAddress,
        duration_ms: durationMs,
        updated_at: updatedAt,
      };
      if (index >= 0) this.store.reticulumDmExpiryPreferences[index] = row;
      else this.store.reticulumDmExpiryPreferences.push(row);
      return { changes: 1, lastInsertRowid: Math.max(1, index + 1) };
    }
    if (this.sql.includes('INTO rchat_direct_call_history')) {
      const values = args;
      const [
        ownerAddress,
        callId,
        conversationId,
        peerAddress,
        direction,
        outcome,
        startedAt,
        endedAt,
        updatedAt,
        authorPublicKey,
        signature,
        readAt,
      ] = values;
      const row = {
        owner_address: ownerAddress,
        call_id: callId,
        conversation_id: conversationId,
        peer_address: peerAddress,
        direction,
        outcome,
        started_at: startedAt,
        ended_at: endedAt,
        updated_at: updatedAt,
        author_public_key: authorPublicKey,
        signature,
        read_at: readAt,
      };
      const index = this.store.reticulumDirectCallHistory.findIndex(
        (candidate) =>
          candidate.owner_address === ownerAddress &&
          candidate.call_id === callId
      );
      if (index >= 0) {
        row.read_at = Math.max(
          Number(this.store.reticulumDirectCallHistory[index].read_at || 0),
          Number(row.read_at || 0)
        );
        this.store.reticulumDirectCallHistory[index] = row;
      } else this.store.reticulumDirectCallHistory.push(row);
      return { changes: 1, lastInsertRowid: index + 1 };
    }
    if (
      this.sql.includes('UPDATE rchat_direct_call_history') &&
      this.sql.includes('SET read_at')
    ) {
      const [readAt, ownerAddress, conversationId, upToTimestamp] = args;
      let changes = 0;
      for (const row of this.store.reticulumDirectCallHistory) {
        if (
          row.owner_address === ownerAddress &&
          row.conversation_id === conversationId &&
          row.direction === 'incoming' &&
          row.outcome === 'missed' &&
          Number(row.ended_at) <= Number(upToTimestamp) &&
          Number(row.read_at) === 0
        ) {
          row.read_at = Math.max(Number(row.read_at), Number(readAt));
          changes += 1;
        }
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('INSERT OR IGNORE INTO rchat_dm_expired_event_markers')
    ) {
      const [
        eventId,
        conversationId,
        senderAddress,
        recipientAddress,
        senderStreamId,
        senderSeq,
        timestamp,
        expiredAt,
      ] = args;
      if (
        this.store.reticulumDmExpiredEventMarkers.some(
          (row) => row.event_id === eventId
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumDmExpiredEventMarkers.push({
        event_id: eventId,
        conversation_id: conversationId,
        sender_address: senderAddress,
        recipient_address: recipientAddress,
        sender_stream_id: senderStreamId,
        sender_seq: senderSeq,
        timestamp,
        expired_at: expiredAt,
      });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumDmExpiredEventMarkers.length,
      };
    }
    if (this.sql.includes('DELETE FROM rchat_dm_events WHERE event_id = ?')) {
      const before = this.store.reticulumDmEvents.length;
      this.store.reticulumDmEvents = this.store.reticulumDmEvents.filter(
        (row) => row.event_id !== args[0]
      );
      return {
        changes: before - this.store.reticulumDmEvents.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_dm_read_watermarks')) {
      const [conversationId, address, timestamp] = args;
      const existing = this.store.reticulumDmReadWatermarks.find(
        (row) =>
          row.conversation_id === conversationId && row.address === address
      );
      if (existing) {
        existing.timestamp = Math.max(
          Number(existing.timestamp),
          Number(timestamp)
        );
      } else {
        this.store.reticulumDmReadWatermarks.push({
          conversation_id: conversationId,
          address,
          timestamp,
        });
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO rchat_pending_device_read_state')) {
      const [
        ownerAddress,
        scopeType,
        scopeId,
        groupId,
        channelId,
        conversationId,
        peerAddress,
        upToTimestamp,
        updatedAt,
      ] = args;
      const existing = this.store.reticulumPendingDeviceReadStates.find(
        (row) =>
          row.owner_address === ownerAddress &&
          row.scope_type === scopeType &&
          row.scope_id === scopeId
      );
      const row = {
        owner_address: ownerAddress,
        scope_type: scopeType,
        scope_id: scopeId,
        group_id: groupId,
        channel_id: channelId,
        conversation_id: conversationId,
        peer_address: peerAddress,
        up_to_timestamp: Math.max(
          Number(existing?.up_to_timestamp || 0),
          Number(upToTimestamp)
        ),
        updated_at: updatedAt,
      };
      if (existing) Object.assign(existing, row);
      else this.store.reticulumPendingDeviceReadStates.push(row);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO rchat_device_read_state')) {
      const [
        ownerAddress,
        scopeType,
        scopeId,
        groupId,
        channelId,
        conversationId,
        peerAddress,
        upToTimestamp,
        signedAt,
        authorPublicKey,
        signature,
      ] = args;
      const existing = this.store.reticulumDeviceReadStates.find(
        (row) =>
          row.owner_address === ownerAddress &&
          row.scope_type === scopeType &&
          row.scope_id === scopeId
      );
      if (
        existing &&
        (Number(existing.up_to_timestamp) > Number(upToTimestamp) ||
          (Number(existing.up_to_timestamp) === Number(upToTimestamp) &&
            Number(existing.signed_at) >= Number(signedAt)))
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      const row = {
        owner_address: ownerAddress,
        scope_type: scopeType,
        scope_id: scopeId,
        group_id: groupId,
        channel_id: channelId,
        conversation_id: conversationId,
        peer_address: peerAddress,
        up_to_timestamp: upToTimestamp,
        signed_at: signedAt,
        author_public_key: authorPublicKey,
        signature,
      };
      if (existing) Object.assign(existing, row);
      else this.store.reticulumDeviceReadStates.push(row);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM rchat_pending_device_read_state')) {
      const [ownerAddress, scopeType, scopeId, upToTimestamp] = args;
      const before = this.store.reticulumPendingDeviceReadStates.length;
      this.store.reticulumPendingDeviceReadStates =
        this.store.reticulumPendingDeviceReadStates.filter(
          (row) =>
            !(
              row.owner_address === ownerAddress &&
              row.scope_type === scopeType &&
              row.scope_id === scopeId &&
              Number(row.up_to_timestamp) <= Number(upToTimestamp)
            )
        );
      return {
        changes: before - this.store.reticulumPendingDeviceReadStates.length,
        lastInsertRowid: 0,
      };
    }
    if (
      this.sql.includes('INSERT INTO rchat_missing_range_peer_observations')
    ) {
      const [
        groupId,
        authorAddress,
        authorStreamId,
        fromSeq,
        toSeq,
        peerHash,
        observedAt,
      ] = args;
      const existing =
        this.store.reticulumChatMissingRangePeerObservations.find(
          (row) =>
            row.group_id === groupId &&
            row.author_address === authorAddress &&
            row.author_stream_id === authorStreamId &&
            row.from_seq === fromSeq &&
            row.to_seq === toSeq &&
            row.peer_hash === peerHash
        );
      if (existing) existing.observed_at = observedAt;
      else
        this.store.reticulumChatMissingRangePeerObservations.push({
          group_id: groupId,
          author_address: authorAddress,
          author_stream_id: authorStreamId,
          from_seq: fromSeq,
          to_seq: toSeq,
          peer_hash: peerHash,
          observed_at: observedAt,
        });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE rchat_missing_stream_ranges') &&
      this.sql.includes('SET next_attempt_at = MAX(next_attempt_at')
    ) {
      // Missing ranges are maintained by the database class's in-memory
      // mirror in this lightweight test double. Report the persisted row as
      // present so marker creation follows the real SQLite transaction path.
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO rchat_known_unavailable_ranges')) {
      const row = { ...(args[0] ?? {}) };
      const existing = this.store.reticulumChatKnownUnavailableRanges.find(
        (candidate) =>
          candidate.group_id === row.group_id &&
          candidate.author_address === row.author_address &&
          candidate.author_stream_id === row.author_stream_id &&
          candidate.from_seq === row.from_seq &&
          candidate.to_seq === row.to_seq
      );
      if (existing) Object.assign(existing, row);
      else this.store.reticulumChatKnownUnavailableRanges.push(row);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM rchat_known_unavailable_ranges')) {
      if (this.sql.includes('rowid NOT IN')) {
        const limit = Math.max(1, Number(args[0]) || 1);
        this.store.reticulumChatKnownUnavailableRanges =
          this.store.reticulumChatKnownUnavailableRanges
            .sort(
              (left, right) =>
                Number(right.confirmed_at) - Number(left.confirmed_at)
            )
            .slice(0, limit);
        return { changes: 0, lastInsertRowid: 0 };
      }
      if (!this.sql.includes('author_address')) {
        const [groupId] = args;
        const before = this.store.reticulumChatKnownUnavailableRanges.length;
        this.store.reticulumChatKnownUnavailableRanges =
          this.store.reticulumChatKnownUnavailableRanges.filter(
            (row) => row.group_id !== groupId
          );
        return {
          changes:
            before - this.store.reticulumChatKnownUnavailableRanges.length,
          lastInsertRowid: 0,
        };
      }
      const [groupId, authorAddress, authorStreamId, toSeq, fromSeq] = args;
      const before = this.store.reticulumChatKnownUnavailableRanges.length;
      this.store.reticulumChatKnownUnavailableRanges =
        this.store.reticulumChatKnownUnavailableRanges.filter(
          (row) =>
            row.group_id !== groupId ||
            row.author_address !== authorAddress ||
            row.author_stream_id !== authorStreamId ||
            row.from_seq > toSeq ||
            row.to_seq < fromSeq
        );
      return {
        changes: before - this.store.reticulumChatKnownUnavailableRanges.length,
        lastInsertRowid: 0,
      };
    }
    if (
      this.sql.includes('DELETE FROM rchat_missing_range_peer_observations')
    ) {
      if (this.sql.includes('observed_at < ?')) {
        const [observedBefore] = args;
        const before =
          this.store.reticulumChatMissingRangePeerObservations.length;
        this.store.reticulumChatMissingRangePeerObservations =
          this.store.reticulumChatMissingRangePeerObservations.filter(
            (row) => Number(row.observed_at) >= Number(observedBefore)
          );
        return {
          changes:
            before -
            this.store.reticulumChatMissingRangePeerObservations.length,
          lastInsertRowid: 0,
        };
      }
      const [groupId, authorAddress, authorStreamId, toSeq, fromSeq] = args;
      const before =
        this.store.reticulumChatMissingRangePeerObservations.length;
      this.store.reticulumChatMissingRangePeerObservations =
        this.store.reticulumChatMissingRangePeerObservations.filter(
          (row) =>
            row.group_id !== groupId ||
            row.author_address !== authorAddress ||
            row.author_stream_id !== authorStreamId ||
            row.from_seq > toSeq ||
            row.to_seq < fromSeq
        );
      return {
        changes:
          before - this.store.reticulumChatMissingRangePeerObservations.length,
        lastInsertRowid: 0,
      };
    }
    const [params, second] = args;
    if (this.sql.includes('DELETE FROM rchat_schema_migrations')) {
      const [name] = args;
      const deleted = this.store.reticulumChatSchemaMigrations.delete(
        String(name)
      );
      return { changes: deleted ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO rchat_schema_migrations')) {
      const [name, appliedAt] = args;
      this.store.reticulumChatSchemaMigrations.set(
        String(name),
        Number(appliedAt)
      );
      return { changes: 1, lastInsertRowid: 1 };
    }
    if (this.sql.includes('INSERT INTO rchat_public_group_activity')) {
      const isLocalStateUpsert = !this.sql.includes('VALUES (?, NULL,');
      const row = isLocalStateUpsert
        ? {
            group_id: args[0],
            local_state_json: args[1],
            messages_24h: args[2],
            messages_7d: args[3],
            active_authors_7d: args[4],
            observed_at: args[5],
            confidence: args[6],
            updated_at: args[7],
          }
        : {
            group_id: args[0],
            local_state_json: null,
            messages_24h: args[1],
            messages_7d: args[2],
            active_authors_7d: args[3],
            observed_at: args[4],
            confidence: args[5],
            updated_at: args[6],
          };
      const index = this.store.reticulumPublicGroupActivity.findIndex(
        (existing) => existing.group_id === row.group_id
      );
      if (index >= 0) {
        this.store.reticulumPublicGroupActivity[index] = {
          ...this.store.reticulumPublicGroupActivity[index],
          ...row,
          local_state_json: isLocalStateUpsert
            ? row.local_state_json
            : this.store.reticulumPublicGroupActivity[index].local_state_json,
        };
      } else {
        this.store.reticulumPublicGroupActivity.push(row);
      }
      return { changes: 1, lastInsertRowid: index + 1 };
    }
    if (this.sql.includes('DELETE FROM rchat_public_group_activity')) {
      const before = this.store.reticulumPublicGroupActivity.length;
      if (this.sql.includes('group_id = ?')) {
        this.store.reticulumPublicGroupActivity =
          this.store.reticulumPublicGroupActivity.filter(
            (row) => row.group_id !== args[0]
          );
      } else if (this.sql.includes('observed_at < ?')) {
        this.store.reticulumPublicGroupActivity =
          this.store.reticulumPublicGroupActivity.filter(
            (row) =>
              row.local_state_json != null ||
              Number(row.observed_at) >= Number(args[0])
          );
      } else if (this.sql.includes('group_id NOT IN')) {
        const limit = Math.max(1, Number(args[0]) || 200);
        const retainedRemoteIds = new Set(
          this.store.reticulumPublicGroupActivity
            .filter((row) => row.local_state_json == null)
            .sort(
              (a, b) =>
                Number(b.active_authors_7d) - Number(a.active_authors_7d) ||
                Number(b.messages_24h) - Number(a.messages_24h) ||
                Number(b.messages_7d) - Number(a.messages_7d) ||
                Number(b.observed_at) - Number(a.observed_at) ||
                Number(a.group_id) - Number(b.group_id)
            )
            .slice(0, limit)
            .map((row) => row.group_id)
        );
        this.store.reticulumPublicGroupActivity =
          this.store.reticulumPublicGroupActivity.filter(
            (row) =>
              row.local_state_json != null ||
              retainedRemoteIds.has(row.group_id)
          );
      }
      return {
        changes: before - this.store.reticulumPublicGroupActivity.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_silences')) {
      const [
        ownerAddress,
        targetAddress,
        scopeType,
        scopeId,
        createdAt,
        expiresAt,
        ignoredThrough,
        updatedAt,
      ] = args;
      const index = this.store.reticulumChatSilences.findIndex(
        (row) =>
          row.owner_address === ownerAddress &&
          row.target_address === targetAddress &&
          row.scope_type === scopeType &&
          row.scope_id === scopeId
      );
      const row = {
        owner_address: ownerAddress,
        target_address: targetAddress,
        scope_type: scopeType,
        scope_id: scopeId,
        created_at: createdAt,
        expires_at: expiresAt,
        ignored_through: Number(ignoredThrough || 0),
        updated_at: updatedAt,
      };
      if (index >= 0) this.store.reticulumChatSilences[index] = row;
      else this.store.reticulumChatSilences.push(row);
      return { changes: 1, lastInsertRowid: index + 1 };
    }
    if (this.sql.includes('UPDATE rchat_silences')) {
      const [
        clearedAt,
        updatedAt,
        ownerAddress,
        targetAddress,
        scopeType,
        scopeId,
      ] = args;
      const row = this.store.reticulumChatSilences.find(
        (item) =>
          item.owner_address === ownerAddress &&
          item.target_address === targetAddress &&
          item.scope_type === scopeType &&
          item.scope_id === scopeId
      );
      if (row) {
        row.expires_at = 0;
        row.ignored_through = Number(clearedAt || 0);
        row.updated_at = updatedAt;
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE rchat_dm_events') &&
      this.sql.includes('SET read_at')
    ) {
      const [readAt, conversationId, recipientAddress, upToTimestamp] = args;
      let changes = 0;
      for (const row of this.store.reticulumDmEvents) {
        if (
          row.conversation_id === conversationId &&
          row.recipient_address === recipientAddress &&
          Number(row.timestamp) <= Number(upToTimestamp) &&
          Number(row.read_at) === 0
        ) {
          row.read_at = Math.max(Number(row.read_at), Number(readAt));
          changes += 1;
        }
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INTO rchat_dm_events')) {
      if (
        this.store.reticulumDmEvents.some(
          (row) => row.event_id === params.event_id
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumDmEvents.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumDmEvents.length,
      };
    }
    if (
      this.sql.includes(
        'INSERT OR IGNORE INTO rchat_channel_expiry_reconciliation'
      ) &&
      this.sql.includes('SELECT DISTINCT')
    ) {
      return { changes: 0, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('INSERT INTO rchat_channel_expiry_reconciliation') &&
      this.sql.includes('SELECT groups.group_id')
    ) {
      const [channelId, expiryDurationMs, updatedAt, eventChannelId] = args;
      const groupIds = new Set<number>();
      for (const event of this.store.reticulumChatEvents) {
        if (event.channel_id === eventChannelId) {
          groupIds.add(Number(event.group_id));
        }
      }
      for (const channel of this.store.reticulumChatChannels) {
        if (channel.channel_id === channelId) {
          groupIds.add(Number(channel.group_id));
        }
      }
      let changes = 0;
      for (const groupId of groupIds) {
        if (!Number.isInteger(groupId) || groupId <= 0) continue;
        const existing =
          this.store.reticulumChatChannelExpiryReconciliations.find(
            (row) => row.group_id === groupId && row.channel_id === channelId
          );
        const next = {
          group_id: groupId,
          channel_id: channelId,
          revision: existing ? Number(existing.revision || 1) + 1 : 1,
          expiry_duration_ms: expiryDurationMs,
          after_timestamp: -1,
          after_event_id: '',
          updated_at: updatedAt,
        };
        if (existing) Object.assign(existing, next);
        else this.store.reticulumChatChannelExpiryReconciliations.push(next);
        changes += 1;
      }
      return { changes, lastInsertRowid: changes };
    }
    if (this.sql.includes('INSERT INTO rchat_channel_expiry_reconciliation')) {
      const [groupId, channelId, expiryDurationMs, updatedAt] = args;
      const existing =
        this.store.reticulumChatChannelExpiryReconciliations.find(
          (row) => row.group_id === groupId && row.channel_id === channelId
        );
      const next = {
        group_id: groupId,
        channel_id: channelId,
        revision: existing ? Number(existing.revision || 1) + 1 : 1,
        expiry_duration_ms: expiryDurationMs,
        after_timestamp: -1,
        after_event_id: '',
        updated_at: updatedAt,
      };
      if (existing) Object.assign(existing, next);
      else this.store.reticulumChatChannelExpiryReconciliations.push(next);
      return { changes: 1, lastInsertRowid: 1 };
    }
    if (
      this.sql.includes('UPDATE rchat_channel_expiry_reconciliation') &&
      this.sql.includes('SET expiry_duration_ms = CASE')
    ) {
      const [qortalLandChannelId, qortalLandExpiryMs] = args;
      for (const row of this.store.reticulumChatChannelExpiryReconciliations) {
        const channel = this.store.reticulumChatChannels.find(
          (item) =>
            item.group_id === row.group_id && item.channel_id === row.channel_id
        );
        row.expiry_duration_ms = channel
          ? (channel.expiry_duration_ms ?? null)
          : row.channel_id === qortalLandChannelId
            ? qortalLandExpiryMs
            : null;
      }
      return {
        changes: this.store.reticulumChatChannelExpiryReconciliations.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('UPDATE rchat_channel_expiry_reconciliation')) {
      const [
        afterTimestamp,
        afterEventId,
        updatedAt,
        groupId,
        channelId,
        revision,
        expectedAfterTimestamp,
        expectedAfterEventId,
      ] = args;
      const row = this.store.reticulumChatChannelExpiryReconciliations.find(
        (item) =>
          item.group_id === groupId &&
          item.channel_id === channelId &&
          item.revision === revision &&
          item.after_timestamp === expectedAfterTimestamp &&
          item.after_event_id === expectedAfterEventId
      );
      if (row) {
        row.after_timestamp = afterTimestamp;
        row.after_event_id = afterEventId;
        row.updated_at = updatedAt;
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM rchat_channel_expiry_reconciliation')) {
      const [
        groupId,
        channelId,
        revision,
        expectedAfterTimestamp,
        expectedAfterEventId,
      ] = args;
      const before =
        this.store.reticulumChatChannelExpiryReconciliations.length;
      this.store.reticulumChatChannelExpiryReconciliations =
        this.store.reticulumChatChannelExpiryReconciliations.filter(
          (row) =>
            row.group_id !== groupId ||
            row.channel_id !== channelId ||
            (revision != null &&
              (row.revision !== revision ||
                row.after_timestamp !== expectedAfterTimestamp ||
                row.after_event_id !== expectedAfterEventId))
        );
      return {
        changes:
          before - this.store.reticulumChatChannelExpiryReconciliations.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_author_sequence_leases')) {
      const values = args;
      const row = {
        group_id: values[0],
        author_address: values[1],
        author_stream_id: values[2],
        author_seq: values[3],
        owner_id: values[4],
        owner_pid: values[5],
        created_at: values[6],
      };
      if (
        this.store.reticulumChatAuthorSequenceLeases.some(
          (existing) =>
            existing.group_id === row.group_id &&
            existing.author_address === row.author_address &&
            existing.author_stream_id === row.author_stream_id &&
            existing.author_seq === row.author_seq
        )
      ) {
        throw new Error(
          'UNIQUE constraint failed: rchat_author_sequence_leases'
        );
      }
      this.store.reticulumChatAuthorSequenceLeases.push(row);
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumChatAuthorSequenceLeases.length,
      };
    }
    if (this.sql.includes('INSERT OR REPLACE INTO reticulum_chat_channels')) {
      const values = args;
      const row = {
        group_id: values[0],
        channel_id: values[1],
        category_id: values[2],
        name: values[3],
        description: values[4],
        position: values[5],
        archived: values[6],
        write_mode: values[7],
        read_mode: values[8],
        write_mode_updated_at: values[9],
        expiry_duration_ms: values[10],
        created_by: values[11],
        created_at: values[12],
        updated_at: values[13],
      };
      const index = this.store.reticulumChatChannels.findIndex(
        (existing) =>
          existing.group_id === row.group_id &&
          existing.channel_id === row.channel_id
      );
      if (index >= 0) this.store.reticulumChatChannels[index] = row;
      else this.store.reticulumChatChannels.push(row);
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0 ? index + 1 : this.store.reticulumChatChannels.length,
      };
    }
    if (
      this.sql.includes('UPDATE reticulum_chat_channels') &&
      this.sql.includes('SET expiry_duration_ms = ?')
    ) {
      const expiryDurationMs = args[0];
      const groupScoped = this.sql.includes('group_id = ?');
      const groupId = groupScoped ? args[1] : undefined;
      const channelId = groupScoped ? args[2] : args[1];
      let changes = 0;
      for (const channel of this.store.reticulumChatChannels) {
        if (
          channel.channel_id !== channelId ||
          (groupScoped && channel.group_id !== groupId)
        ) {
          continue;
        }
        channel.expiry_duration_ms = expiryDurationMs;
        changes += 1;
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM reticulum_chat_channels')) {
      const [groupId, channelId] = args;
      const before = this.store.reticulumChatChannels.length;
      this.store.reticulumChatChannels =
        this.store.reticulumChatChannels.filter(
          (row) => !(row.group_id === groupId && row.channel_id === channelId)
        );
      return {
        changes: before - this.store.reticulumChatChannels.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('DELETE FROM rchat_author_sequence_leases')) {
      const values = args;
      const before = this.store.reticulumChatAuthorSequenceLeases.length;
      if (this.sql.includes('group_id = ?')) {
        const [groupId, authorAddress, authorStreamId, authorSeq, ownerId] =
          values;
        this.store.reticulumChatAuthorSequenceLeases =
          this.store.reticulumChatAuthorSequenceLeases.filter(
            (row) =>
              !(
                row.group_id === groupId &&
                row.author_address === authorAddress &&
                row.author_stream_id === authorStreamId &&
                row.author_seq === authorSeq &&
                row.owner_id === ownerId
              )
          );
      } else {
        this.store.reticulumChatAuthorSequenceLeases =
          this.store.reticulumChatAuthorSequenceLeases.filter(
            (row) => row.owner_id !== values[0]
          );
      }
      return {
        changes: before - this.store.reticulumChatAuthorSequenceLeases.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT OR IGNORE INTO rchat_event_headers')) {
      if (
        this.store.reticulumChatEventHeaders.some(
          (row) => row.event_id === params.event_id
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumChatEventHeaders.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumChatEventHeaders.length,
      };
    }
    if (this.sql.includes('INSERT OR IGNORE INTO rchat_author_streams')) {
      if (!this.store.reticulumChatAuthorStreams.has(params.author_address)) {
        this.store.reticulumChatAuthorStreams.set(
          params.author_address,
          params.stream_id
        );
        return { changes: 1, lastInsertRowid: 1 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT OR REPLACE INTO rchat_metadata_snapshots')) {
      const values = args;
      const row =
        params && typeof params === 'object' && !Array.isArray(params)
          ? { ...params }
          : {
              group_id: values[0],
              snapshot_id: values[1],
              scope: values[2],
              parent_snapshot_hash: values[3],
              version: values[4],
              created_at: values[5],
              latest_event_id: values[6],
              latest_feed_timestamp: values[7],
              snapshot_hash: values[8],
              admin_address: values[9],
              admin_public_key: values[10],
              signature: values[11],
              channels_json: values[12],
              categories_json: values[13],
            };
      const index = this.store.reticulumChatMetadataSnapshots.findIndex(
        (existing) =>
          (existing.group_id === row.group_id &&
            existing.snapshot_id === row.snapshot_id) ||
          (existing.group_id === row.group_id &&
            existing.snapshot_hash === row.snapshot_hash)
      );
      if (index >= 0) this.store.reticulumChatMetadataSnapshots[index] = row;
      else this.store.reticulumChatMetadataSnapshots.push(row);
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0
            ? index + 1
            : this.store.reticulumChatMetadataSnapshots.length,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_metadata_entity_revisions')) {
      const values = args;
      const row = {
        group_id: values[0],
        entity_type: values[1],
        entity_id: values[2],
        event_id: values[3],
        event_type: values[4],
        event_timestamp: values[5],
        deleted: values[6],
        state_hash: values[7],
        source_kind: values[8] ?? 'event',
      };
      const index = this.store.reticulumChatMetadataEntityRevisions.findIndex(
        (existing) =>
          existing.group_id === row.group_id &&
          existing.entity_type === row.entity_type &&
          existing.entity_id === row.entity_id
      );
      if (index >= 0)
        this.store.reticulumChatMetadataEntityRevisions[index] = row;
      else this.store.reticulumChatMetadataEntityRevisions.push(row);
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0
            ? index + 1
            : this.store.reticulumChatMetadataEntityRevisions.length,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resources')) {
      const index = this.store.reticulumResources.findIndex(
        (row) => row.file_hash === params.file_hash
      );
      if (index >= 0) {
        const existing = this.store.reticulumResources[index];
        this.store.reticulumResources[index] = {
          ...existing,
          size_bytes: params.size_bytes,
          encrypted: params.encrypted,
          status: existing.status === 'complete' ? 'complete' : params.status,
          assembled_path:
            params.assembled_path !== undefined
              ? params.assembled_path
              : existing.assembled_path,
          partial_path:
            params.partial_path !== undefined
              ? params.partial_path
              : existing.partial_path,
          owner_id: existing.owner_id ?? params.owner_id,
          metadata: existing.metadata ?? params.metadata,
          thumbnail: existing.thumbnail ?? params.thumbnail,
          updated_at: params.updated_at,
          final_verified_at:
            params.final_verified_at ?? existing.final_verified_at,
          provenance:
            existing.provenance === 'local_authored'
              ? 'local_authored'
              : params.provenance,
          resident_bytes: Math.max(
            Number(existing.resident_bytes || 0),
            Number(params.resident_bytes || 0)
          ),
          last_accessed_at:
            params.last_accessed_at ?? existing.last_accessed_at,
          last_served_at: params.last_served_at ?? existing.last_served_at,
          access_count: Math.max(
            Number(existing.access_count || 0),
            Number(params.access_count || 0)
          ),
          retention_until:
            Math.max(
              Number(existing.retention_until || 0),
              Number(params.retention_until || 0)
            ) || null,
          managed: Math.max(
            Number(existing.managed || 0),
            Number(params.managed || 0)
          ),
        };
        return { changes: 1, lastInsertRowid: index + 1 };
      }
      this.store.reticulumResources.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumResources.length,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_meta')) {
      const [key, value] = args;
      this.store.reticulumResourceMeta.set(String(key), String(value));
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (this.sql.includes('UPDATE reticulum_resources')) {
      const values = args;
      const fileHash = values[values.length - 1];
      const row = this.store.reticulumResources.find(
        (item) => item.file_hash === fileHash
      );
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      if (this.sql.includes('SET status = ?')) {
        const [status, assembledPath, partialPath, updatedAt, finalVerifiedAt] =
          values;
        row.status = status;
        row.assembled_path = assembledPath;
        row.partial_path = partialPath;
        row.updated_at = updatedAt;
        row.final_verified_at = finalVerifiedAt;
      } else if (this.sql.includes('SET partial_path = ?')) {
        const [partialPath, updatedAt] = values;
        row.partial_path = partialPath;
        row.updated_at = updatedAt;
      } else if (this.sql.includes("SET provenance = 'local_authored'")) {
        row.provenance = 'local_authored';
        if (this.sql.includes('retention_until = NULL'))
          row.retention_until = null;
        if (this.sql.includes('managed = MAX')) {
          row.managed = Math.max(
            Number(row.managed || 0),
            Number(values[0] || 0)
          );
          row.updated_at = values[1];
        } else {
          row.updated_at = values[0];
        }
      } else if (this.sql.includes('SET managed = 1')) {
        row.managed = 1;
        row.updated_at = values[0];
      } else if (this.sql.includes("SET provenance = 'remote_downloaded'")) {
        row.provenance = 'remote_downloaded';
      } else if (this.sql.includes('SET provenance = CASE')) {
        if (row.provenance !== 'local_authored') row.provenance = 'replica';
        row.retention_until = Math.max(
          Number(row.retention_until || 0),
          Number(values[0] || 0)
        );
        row.updated_at = values[1];
      } else if (this.sql.includes('SET resident_bytes = 0')) {
        row.resident_bytes = 0;
        row.updated_at = values[0];
      } else if (this.sql.includes('SET resident_bytes = ?')) {
        row.resident_bytes = Number(values[0] || 0);
        if (this.sql.includes('retention_until = CASE')) {
          if (row.provenance !== 'local_authored') {
            row.retention_until = Math.max(
              Number(row.retention_until || 0),
              Number(values[1] || 0)
            );
          }
          row.updated_at = values[2];
        } else {
          row.updated_at = values[1];
        }
      } else if (this.sql.includes('SET retention_until = MAX')) {
        if (row.provenance !== 'local_authored') {
          row.retention_until = Math.max(
            Number(row.retention_until || 0),
            Number(values[0] || 0)
          );
        }
      } else if (this.sql.includes('SET last_served_at = ?')) {
        row.last_served_at = values[0];
        if (this.sql.includes('last_accessed_at = ?')) {
          row.last_accessed_at = values[1];
        }
        row.access_count = Number(row.access_count || 0) + 1;
      } else if (this.sql.includes('SET last_accessed_at = ?')) {
        row.last_accessed_at = values[0];
        row.access_count = Number(row.access_count || 0) + 1;
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT OR REPLACE INTO reticulum_resource_ranges')) {
      const values = args;
      const row = {
        file_hash: values[0],
        start_byte: values[1],
        end_byte_exclusive: values[2],
        status: 'complete',
        updated_at: values[3],
      };
      const index = this.store.reticulumResourceRanges.findIndex(
        (existing) =>
          existing.file_hash === row.file_hash &&
          existing.start_byte === row.start_byte &&
          existing.end_byte_exclusive === row.end_byte_exclusive
      );
      if (index >= 0) this.store.reticulumResourceRanges[index] = row;
      else this.store.reticulumResourceRanges.push(row);
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0 ? index + 1 : this.store.reticulumResourceRanges.length,
      };
    }
    if (this.sql.includes('DELETE FROM reticulum_resource_ranges')) {
      const [fileHash, overlapEnd, overlapStart] = args;
      const before = this.store.reticulumResourceRanges.length;
      this.store.reticulumResourceRanges =
        this.store.reticulumResourceRanges.filter(
          (row) =>
            row.file_hash !== fileHash ||
            (this.sql.includes('start_byte <= ?') &&
              !(
                Number(row.start_byte) <= Number(overlapEnd) &&
                Number(row.end_byte_exclusive) >= Number(overlapStart)
              ))
        );
      return {
        changes: before - this.store.reticulumResourceRanges.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_group_refs')) {
      const values = args;
      const row = {
        file_hash: values[0],
        group_id: values[1],
        event_id: values[2],
        owner_id: values[3],
        created_at: values[4],
        updated_at: values[5],
      };
      const index = this.store.reticulumResourceGroupRefs.findIndex(
        (existing) =>
          existing.file_hash === row.file_hash &&
          existing.group_id === row.group_id &&
          existing.event_id === row.event_id
      );
      if (index >= 0) {
        this.store.reticulumResourceGroupRefs[index] = {
          ...this.store.reticulumResourceGroupRefs[index],
          owner_id:
            row.owner_id ??
            this.store.reticulumResourceGroupRefs[index].owner_id,
          updated_at: row.updated_at,
        };
      } else {
        this.store.reticulumResourceGroupRefs.push(row);
      }
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0 ? index + 1 : this.store.reticulumResourceGroupRefs.length,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_refs')) {
      const values = args;
      const row = {
        file_hash: values[0],
        scope_type: values[1],
        scope_id: values[2],
        event_id: values[3],
        owner_id: values[4],
        namespace: values[5],
        file_name: values[6],
        mime_type: values[7],
        size_bytes: values[8],
        encrypted: values[9],
        metadata: values[10],
        thumbnail: values[11],
        state: values[12],
        locally_authored: values[13],
        created_at: values[14],
        updated_at: values[15],
        expires_at: values[16] ?? null,
      };
      const index = this.store.reticulumResourceRefs.findIndex(
        (existing) =>
          existing.file_hash === row.file_hash &&
          existing.scope_type === row.scope_type &&
          existing.scope_id === row.scope_id &&
          existing.event_id === row.event_id
      );
      if (index >= 0) {
        const existing = this.store.reticulumResourceRefs[index];
        this.store.reticulumResourceRefs[index] = {
          ...existing,
          ...row,
          owner_id: row.owner_id ?? existing.owner_id,
          locally_authored: Math.max(
            Number(existing.locally_authored || 0),
            Number(row.locally_authored || 0)
          ),
          created_at: existing.created_at,
          state: ['deleted', 'expired'].includes(String(existing.state))
            ? existing.state
            : row.state,
          expires_at:
            existing.expires_at == null
              ? row.expires_at
              : row.expires_at == null
                ? existing.expires_at
                : Math.min(Number(existing.expires_at), Number(row.expires_at)),
        };
      } else {
        this.store.reticulumResourceRefs.push(row);
      }
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0 ? index + 1 : this.store.reticulumResourceRefs.length,
      };
    }
    if (this.sql.includes('UPDATE reticulum_resource_refs')) {
      const values = args;
      let changes = 0;
      if (this.sql.includes("json_extract(metadata, '$.feature')")) {
        const [state, updatedAt, groupId, eventId] = values;
        for (const row of this.store.reticulumResourceRefs) {
          let metadata: Record<string, unknown> | null = null;
          try {
            metadata = row.metadata ? JSON.parse(row.metadata) : null;
          } catch {
            metadata = null;
          }
          if (
            row.scope_type === 'group' &&
            row.scope_id === groupId &&
            row.event_id === eventId &&
            row.namespace === 'reticulum-group-resource' &&
            metadata?.feature === 'reticulum-calendar-cover'
          ) {
            row.state = state;
            row.updated_at = updatedAt;
            changes += 1;
          }
        }
      } else if (this.sql.includes('SET expires_at = ?, updated_at = ?')) {
        const [expiresAt, updatedAt, scopeType, scopeId, eventId] = values;
        for (const row of this.store.reticulumResourceRefs) {
          if (
            row.scope_type === scopeType &&
            row.scope_id === scopeId &&
            row.event_id === eventId &&
            row.state === 'live'
          ) {
            row.expires_at = expiresAt;
            row.updated_at = updatedAt;
            changes += 1;
          }
        }
      } else if (this.sql.includes('SET expires_at = ?')) {
        const [expiresAt, fileHash, scopeType, scopeId, eventId] = values;
        for (const row of this.store.reticulumResourceRefs) {
          if (
            row.file_hash === fileHash &&
            row.scope_type === scopeType &&
            row.scope_id === scopeId &&
            row.event_id === eventId
          ) {
            row.expires_at = expiresAt;
            changes += 1;
          }
        }
      } else if (this.sql.includes("SET state = 'expired'")) {
        const [updatedAt, now] = values;
        for (const row of this.store.reticulumResourceRefs) {
          if (
            row.state === 'live' &&
            row.expires_at != null &&
            Number(row.expires_at) <= Number(now)
          ) {
            row.state = 'expired';
            row.updated_at = updatedAt;
            changes += 1;
          }
        }
      } else if (this.sql.includes('SET state = ?')) {
        const [state, updatedAt, scopeType, scopeId, eventId, fileHash] =
          values;
        for (const row of this.store.reticulumResourceRefs) {
          if (
            row.scope_type === scopeType &&
            row.scope_id === scopeId &&
            row.event_id === eventId &&
            (fileHash == null || row.file_hash === fileHash)
          ) {
            row.state = state;
            row.updated_at = updatedAt;
            changes += 1;
          }
        }
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_leases')) {
      const values = args;
      const next = {
        lease_id: values[0],
        file_hash: values[1],
        lease_type: values[2],
        expires_at: values[3],
        created_at: values[4],
      };
      const existing = this.store.reticulumResourceLeases.findIndex(
        (row) => row.lease_id === next.lease_id
      );
      if (existing >= 0) {
        this.store.reticulumResourceLeases[existing] = {
          ...this.store.reticulumResourceLeases[existing],
          ...next,
          created_at: this.store.reticulumResourceLeases[existing].created_at,
        };
      } else {
        this.store.reticulumResourceLeases.push(next);
      }
      return {
        changes: 1,
        lastInsertRowid:
          existing >= 0
            ? existing + 1
            : this.store.reticulumResourceLeases.length,
      };
    }
    if (this.sql.includes('UPDATE reticulum_resource_leases')) {
      const values = args;
      const row = this.store.reticulumResourceLeases.find(
        (item) => item.lease_id === values[1]
      );
      if (row) row.expires_at = values[0];
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM reticulum_resource_leases')) {
      const values = args;
      const before = this.store.reticulumResourceLeases.length;
      this.store.reticulumResourceLeases =
        this.store.reticulumResourceLeases.filter((row) =>
          this.sql.includes('expires_at <= ?')
            ? Number(row.expires_at) > Number(values[0])
            : row.lease_id !== values[0]
        );
      return {
        changes: before - this.store.reticulumResourceLeases.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_reservations')) {
      const values = args;
      this.store.reticulumResourceReservations.push({
        reservation_id: values[0],
        file_hash: values[1],
        provenance: values[2],
        size_bytes: values[3],
        expires_at: values[4],
        created_at: values[5],
      });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumResourceReservations.length,
      };
    }
    if (this.sql.includes('UPDATE reticulum_resource_reservations')) {
      const values = args;
      const updatesSize = this.sql.includes('SET size_bytes = ?');
      const reservationId = updatesSize ? values[2] : values[1];
      const row = this.store.reticulumResourceReservations.find(
        (item) => item.reservation_id === reservationId
      );
      if (row) {
        if (updatesSize) {
          row.size_bytes = values[0];
          row.expires_at = values[1];
        } else {
          row.expires_at = values[0];
        }
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('DELETE FROM reticulum_resource_reservations')) {
      const values = args;
      const before = this.store.reticulumResourceReservations.length;
      this.store.reticulumResourceReservations =
        this.store.reticulumResourceReservations.filter((row) =>
          this.sql.includes('expires_at <= ?')
            ? Number(row.expires_at) > Number(values[0])
            : row.reservation_id !== values[0]
        );
      return {
        changes: before - this.store.reticulumResourceReservations.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_providers')) {
      const values = args;
      const row = {
        file_hash: values[0],
        provider_id: values[1],
        scope_type: values[2],
        scope_id: values[3],
        receipt_at: values[4],
        retention_until: values[5],
        last_confirmed_at: values[6],
      };
      const index = this.store.reticulumResourceProviders.findIndex(
        (existing) =>
          existing.file_hash === row.file_hash &&
          existing.provider_id === row.provider_id &&
          existing.scope_type === row.scope_type &&
          existing.scope_id === row.scope_id
      );
      if (index >= 0) {
        const existing = this.store.reticulumResourceProviders[index];
        this.store.reticulumResourceProviders[index] = {
          ...existing,
          receipt_at: row.receipt_at,
          retention_until: Math.max(
            Number(existing.retention_until),
            Number(row.retention_until)
          ),
          last_confirmed_at: row.last_confirmed_at,
        };
      } else {
        this.store.reticulumResourceProviders.push(row);
      }
      return {
        changes: 1,
        lastInsertRowid:
          index >= 0 ? index + 1 : this.store.reticulumResourceProviders.length,
      };
    }
    if (this.sql.includes('DELETE FROM reticulum_resource_providers')) {
      const before = this.store.reticulumResourceProviders.length;
      this.store.reticulumResourceProviders =
        this.store.reticulumResourceProviders.filter(
          (row) => Number(row.retention_until) > Number(params)
        );
      return {
        changes: before - this.store.reticulumResourceProviders.length,
        lastInsertRowid: 0,
      };
    }
    if (this.sql.includes('INSERT INTO reticulum_resource_chunks')) {
      const index = this.store.reticulumResourceChunks.findIndex(
        (row) =>
          row.file_hash === params.file_hash &&
          row.chunk_index === params.chunk_index
      );
      if (index >= 0) {
        this.store.reticulumResourceChunks[index] = {
          ...this.store.reticulumResourceChunks[index],
          ...params,
        };
        return { changes: 1, lastInsertRowid: index + 1 };
      }
      this.store.reticulumResourceChunks.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumResourceChunks.length,
      };
    }
    if (this.sql.includes('UPDATE reticulum_resource_chunks')) {
      const [localPath, updatedAt, fileHash, chunkIndex] = Array.isArray(params)
        ? params
        : [params, second, args[2], args[3]];
      const row = this.store.reticulumResourceChunks.find(
        (item) => item.file_hash === fileHash && item.chunk_index === chunkIndex
      );
      if (row) {
        row.status = 'complete';
        row.local_path = localPath;
        row.updated_at = updatedAt;
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (this.sql.includes('INSERT OR IGNORE INTO reticulum_chat_events')) {
      if (
        this.store.reticulumChatEvents.some(
          (row) =>
            row.event_id === params.event_id ||
            (row.group_id === params.group_id &&
              row.author_address === params.author_address &&
              String(row.author_stream_id || '') ===
                String(params.author_stream_id || '') &&
              row.author_seq === params.author_seq)
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumChatEvents.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumChatEvents.length,
      };
    }
    if (
      this.sql.includes('INSERT OR IGNORE INTO rchat_expired_event_markers')
    ) {
      const values = args;
      const [
        eventId,
        groupId,
        channelId,
        authorAddress,
        authorStreamId,
        authorSeq,
        timestamp,
        expiredAt,
      ] = values;
      if (
        this.store.reticulumChatExpiredEventMarkers.some(
          (row) => row.event_id === eventId
        )
      ) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.store.reticulumChatExpiredEventMarkers.push({
        event_id: eventId,
        group_id: groupId,
        channel_id: channelId,
        author_address: authorAddress,
        author_stream_id: authorStreamId,
        author_seq: authorSeq,
        timestamp,
        expired_at: expiredAt,
      });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumChatExpiredEventMarkers.length,
      };
    }
    if (this.sql.includes('INSERT INTO rchat_message_projection')) {
      const index = this.store.reticulumChatMessages.findIndex(
        (row) => row.root_event_id === params.root_event_id
      );
      if (index >= 0) {
        this.store.reticulumChatMessages[index] = {
          ...this.store.reticulumChatMessages[index],
          ...params,
        };
        return { changes: 1, lastInsertRowid: index + 1 };
      }
      this.store.reticulumChatMessages.push({ ...params });
      return {
        changes: 1,
        lastInsertRowid: this.store.reticulumChatMessages.length,
      };
    }
    if (
      this.sql.includes('UPDATE reticulum_chat_events SET last_served_at = ?')
    ) {
      const [lastServedAt, eventId] = [params, second];
      const row = this.store.reticulumChatEvents.find(
        (item) => item.event_id === eventId
      );
      if (row) row.last_served_at = lastServedAt;
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes(
        'UPDATE reticulum_chat_events SET privileged_mention_status = ?'
      )
    ) {
      const [status, eventId] = Array.isArray(params)
        ? params
        : [params, second];
      const row = this.store.reticulumChatEvents.find(
        (item) => item.event_id === eventId
      );
      if (row) row.privileged_mention_status = status;
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE reticulum_chat_events') &&
      this.sql.includes('SET expires_at = ?')
    ) {
      const values = Array.isArray(params) ? params : args;
      const updatesMutation = this.sql.includes('target_event_id = ?');
      const updatesMessageExpiry = this.sql.includes(
        'message_expiry_duration_ms = ?'
      );
      const expiresAt = values[0];
      const messageExpiryDurationMs = updatesMessageExpiry ? values[1] : null;
      const eventId = values[updatesMessageExpiry ? 2 : 1];
      let changes = 0;
      for (const row of this.store.reticulumChatEvents) {
        const matches = updatesMutation
          ? row.target_event_id === eventId
          : row.event_id === eventId;
        if (!matches) continue;
        row.expires_at = expiresAt;
        if (updatesMessageExpiry) {
          row.message_expiry_duration_ms = messageExpiryDurationMs;
        }
        changes += 1;
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE rchat_event_headers') &&
      this.sql.includes('SET expires_at = ?')
    ) {
      const values = Array.isArray(params) ? params : args;
      const updatesMutation = this.sql.includes('target_event_id = ?');
      const updatesMessageExpiry = this.sql.includes(
        'message_expiry_duration_ms = ?'
      );
      const expiresAt = values[0];
      const messageExpiryDurationMs = updatesMessageExpiry ? values[1] : null;
      const eventId = values[updatesMessageExpiry ? 2 : 1];
      let changes = 0;
      for (const row of this.store.reticulumChatEventHeaders) {
        const matches = updatesMutation
          ? row.target_event_id === eventId
          : row.event_id === eventId;
        if (!matches) continue;
        row.expires_at = expiresAt;
        if (updatesMessageExpiry) {
          row.message_expiry_duration_ms = messageExpiryDurationMs;
        }
        changes += 1;
      }
      return { changes, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('UPDATE rchat_message_projection') &&
      this.sql.includes('SET expires_at = ?')
    ) {
      const [expiresAt, rootEventId] = Array.isArray(params)
        ? params
        : [params, second];
      const row = this.store.reticulumChatMessages.find(
        (item) => item.root_event_id === rootEventId
      );
      if (row) row.expires_at = expiresAt;
      return { changes: row ? 1 : 0, lastInsertRowid: 0 };
    }
    if (
      this.sql.includes('DELETE FROM reticulum_chat_events WHERE event_id = ?')
    ) {
      const before = this.store.reticulumChatEvents.length;
      this.store.reticulumChatEvents = this.store.reticulumChatEvents.filter(
        (row) => row.event_id !== params
      );
      return {
        changes: before - this.store.reticulumChatEvents.length,
        lastInsertRowid: 0,
      };
    }
    if (
      this.sql.includes(
        'DELETE FROM rchat_message_projection WHERE root_event_id = ?'
      )
    ) {
      const before = this.store.reticulumChatMessages.length;
      this.store.reticulumChatMessages =
        this.store.reticulumChatMessages.filter(
          (row) => row.root_event_id !== params
        );
      return {
        changes: before - this.store.reticulumChatMessages.length,
        lastInsertRowid: 0,
      };
    }
    return { changes: 0, lastInsertRowid: 0 };
  }
}

class MockDatabase {
  private readonly store: MockStore;

  constructor(dbPath = ':memory:') {
    const key = String(dbPath);
    const store = storesByPath.get(key) ?? {
      reticulumChatEvents: [],
      reticulumChatEventHeaders: [],
      reticulumChatMessages: [],
      reticulumChatExpiredEventMarkers: [],
      reticulumChatRejectedEventMarkers: [],
      reticulumChatRejectedDigestMarkers: [],
      reticulumChatMetadataSnapshots: [],
      reticulumChatMetadataEntityRevisions: [],
      reticulumChatChannels: [],
      reticulumChatChannelExpiryReconciliations: [],
      reticulumChatSchemaMigrations: new Map(),
      reticulumChatAuthorStreams: new Map(),
      reticulumChatAuthorSequenceLeases: [],
      reticulumChatMissingRangePeerObservations: [],
      reticulumChatKnownUnavailableRanges: [],
      reticulumChatSilences: [],
      reticulumPublicGroupActivity: [],
      reticulumCalendarMutations: [],
      reticulumCalendarEvents: [],
      reticulumCalendarReminders: [],
      reticulumDmEvents: [],
      reticulumDmExpiredEventMarkers: [],
      reticulumDmExpiryPreferences: [],
      reticulumDmReadWatermarks: [],
      reticulumDirectCallHistory: [],
      reticulumDeviceReadStates: [],
      reticulumPendingDeviceReadStates: [],
      reticulumResources: [],
      reticulumResourceChunks: [],
      reticulumResourceRanges: [],
      reticulumResourceGroupRefs: [],
      reticulumResourceRefs: [],
      reticulumResourceLeases: [],
      reticulumResourceReservations: [],
      reticulumResourceProviders: [],
      reticulumResourceMeta: new Map(),
      schema: new Map<string, Set<string>>(),
    };
    storesByPath.set(key, store);
    this.store = store;
  }

  close() {
    return undefined;
  }

  exec(sql = '') {
    this.applySchemaSql(String(sql));
    return undefined;
  }

  prepare(sql = '') {
    return new Statement(String(sql), this.store);
  }

  pragma() {
    return undefined;
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => fn(...args)) as T;
  }

  private applySchemaSql(sql: string): void {
    const dropTablePattern =
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi;
    let dropMatch: RegExpExecArray | null;
    while ((dropMatch = dropTablePattern.exec(sql))) {
      this.store.schema.delete(dropMatch[1]);
    }

    const createTablePattern =
      /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)\s*\(([\s\S]*?)\);/gi;
    let createMatch: RegExpExecArray | null;
    while ((createMatch = createTablePattern.exec(sql))) {
      const tableName = createMatch[1];
      const columns = this.store.schema.get(tableName) ?? new Set<string>();
      for (const line of createMatch[2].split('\n')) {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed) continue;
        const [name = ''] = trimmed.split(/\s+/);
        const normalized = name.replace(/^["'`]|["'`]$/g, '');
        if (
          !normalized ||
          ['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT'].includes(
            normalized.toUpperCase()
          )
        ) {
          continue;
        }
        columns.add(normalized);
      }
      this.store.schema.set(tableName, columns);
    }

    const alterAddPattern =
      /ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/gi;
    let alterMatch: RegExpExecArray | null;
    while ((alterMatch = alterAddPattern.exec(sql))) {
      const [, tableName, columnName] = alterMatch;
      const columns = this.store.schema.get(tableName) ?? new Set<string>();
      columns.add(columnName);
      this.store.schema.set(tableName, columns);
    }
  }
}

export default MockDatabase;
export type Database = InstanceType<typeof MockDatabase>;
