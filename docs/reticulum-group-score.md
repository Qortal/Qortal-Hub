# Reticulum Group Score

Group Score is a group-discovery signal shown in Reticulum Q-Chat. It is an integer from 0 to 100 that combines four independent signals for both open and private groups.

## Formula

```text
Group Score = QORT Holdings × 50% + Activity × 30% + Community × 10% + Legacy × 10%
```

The weighted result is rounded and clamped to 0–100.

### QORT Holdings — 50%

Holding is normalized against a target of 1,000,000 QORT:

```text
Holding Score = 100 × log(1 + balance) / log(1 + 1,000,000)
```

The score is capped at 100. A logarithmic curve was chosen instead of a linear one so a very large holder cannot flatten the useful differences between every other group. The 50% weight is an explicit product decision from the developer discussion.

### Activity — 30%

Activity combines three seven-day/recent participation signals. Each component scales proportionally to its target and is capped at 100:

```text
Activity Score =
  active authors over 7 days (target 50) × 50%
  + messages over 7 days (target 500) × 30%
  + messages over 24 hours (target 100) × 20%
```

One visible user post counts once. Active authors carry the most weight because participation breadth is harder to inflate than message volume; seven-day volume rewards sustained use; 24-hour volume adds recency without letting a short burst dominate. Activity contributes up to 30 points, making sustained participation the second-largest signal after QORT Holdings.

A successfully fetched activity directory that omits a group is treated as zero activity. If the complete activity request fails, an existing valid snapshot is retained instead of replacing Activity with zeros. Activity for private groups starts accumulating from newly accepted messages after support is enabled; existing private history is not backfilled.

### Community — 10%

Member count maps to ten tiers, then to the shared scale as `tier × 10`:

| Members     | Tier / score |
| ----------- | ------------ |
| 0–10        | 1 / 10       |
| 11–25       | 2 / 20       |
| 26–50       | 3 / 30       |
| 51–99       | 4 / 40       |
| 100–249     | 5 / 50       |
| 250–499     | 6 / 60       |
| 500–999     | 7 / 70       |
| 1,000–2,499 | 8 / 80       |
| 2,500–4,999 | 9 / 90       |
| 5,000+      | 10 / 100     |

Community contributes at most 10 points to the total. A group reaches 9/10 Community points at 2,500 members and the full 10/10 at 5,000 members.

### Legacy — 10%

Legacy starts at zero and awards one total-score point for each completed year since the group was created. It caps at 10 points after ten completed years. This gives established groups modest recognition without preventing a new group from reaching 90/100 through QORT Holdings, Activity, and Community alone.

## Refresh and persistence

Q-Chat starts score discovery when Reticulum Q-Chat loads, not only when Find Groups opens. A snapshot is stored locally and shared by invitation previews, About Group, and discovery.

- Snapshots use six-hour slots based on Qortal network time, producing four scheduled refresh opportunities per day.
- Cached score data may be reused for up to 24 hours when a later fetch is unavailable.
- A newly encountered group can request an out-of-cycle refresh, with a five-minute cooldown.
- Real activity data may replace an assumed zero within the same slot.
- Holding data comes from `/groups/balances?limit=0&reverse=true`; Activity comes from the Reticulum group-discovery activity directory.

## Display and discovery

Score colors are consistent anywhere Group Score appears:

- 0–24: red
- 25–44: orange
- 45–64: yellow
- 65–94: green
- 95–100: Qortal blue

Find Groups uses deterministic tie-breakers so equal values do not jump unpredictably:

- **Top:** Group Score, Activity, members, newest.
- **Active:** Activity, active authors, seven-day posts, Group Score, members, newest.
- **Newest:** creation time, then group ID.
- **Largest:** members, Group Score, newest.

The implementation and constants live in `src/components/Group/reticulumGroupScore.ts`.
