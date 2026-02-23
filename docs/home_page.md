# Home Page — Configurable Elements

This document lists every element on the Home page that can be customised without
touching component logic. All entries are data-only changes.

---

## 1. Featured Apps

**File:** `src/components/Apps/config/officialApps.ts`

The `featured` array controls which apps appear in the horizontal scrollable row
of the **Featured Apps** section (User tab). Order in the array equals display order.

```ts
export const officialAppsConfig = {
  featured: ['Q-Blog', 'Q-Mail', 'Q-Search', 'Q-Trade', 'Q-Tube', 'Q-Wallets'],
  ...
};
```

Each entry must be a valid Qortal app name (exact case). The avatar image is fetched
automatically from QDN using the name as the QDN resource name.

To add an app to the Featured section, also add it to the `all` array with
`featured: true` so helpers like `isFeaturedApp()` stay in sync.

---

## 2. Featured Groups

**File:** `src/data/featuredGroups.ts`

The `featuredGroups` array controls the cards in the **Featured Groups** section
(User tab). Each card shows the group avatar, name, and description.

```ts
export const featuredGroups: FeaturedGroup[] = [
  { id: 694, name: 'Qortal',              description: 'Official Qortal community group' },
  { id: 700, name: 'Qortal-General-Chat', description: 'General chat for the Qortal community' },
  { id: 706, name: 'Q-Apps',             description: 'Discussion and support for Qortal Q-Apps' },
];
```

| Field         | Description                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `id`          | Qortal group ID. Used to navigate to the group and to build the avatar URL (`qortal_group_avatar_<id>`). |
| `name`        | Must match the exact Qortal group name. Used to resolve the group owner's avatar.                        |
| `description` | Subtitle displayed on the card (2-line clamp).                                                           |

---

## 3. Developer Tab — Resource Cards

**File:** `src/components/Group/HomeDeveloperTab.tsx`

The Developer tab shows three hardcoded resource cards. Two of them link to Qortal
groups; one opens a Q-App. To change targets, update the constants and the `cards`
array.

```ts
// Group targets (top of file)
const CORE_SUPPORT_GROUP   = { id: 120, name: 'Qortal-CORE-Support' };
const DEVNET_TESTING_GROUP = { id: 269, name: 'Q-App-DevNet-Testing' };

// Cards definition (inside the component)
const cards = [
  {
    key: 'qtube_tutorial',
    icon: <VideoLibraryIcon />,
    title:       t('tutorial:home.qtube_tutorial'),
    description: t('tutorial:home.qtube_tutorial_desc'),
    onAction: () => openApp('q-tube'),           // ← app name here
  },
  {
    key: 'core_support',
    icon: <GroupsIcon />,
    title:       t('tutorial:home.core_support'),
    description: t('tutorial:home.core_support_desc'),
    onAction: () => openGroup(CORE_SUPPORT_GROUP),
  },
  {
    key: 'devnet_testing',
    icon: <BuildIcon />,
    title:       t('tutorial:home.devnet_testing'),
    description: t('tutorial:home.devnet_testing_desc'),
    onAction: () => openGroup(DEVNET_TESTING_GROUP),
  },
];
```

To change a group target update the matching constant (`id` + `name`).
To change the Q-Tube card to a different app, replace `'q-tube'` in `openApp(...)`.
Card titles and descriptions are i18n keys (see section 5).

---

## 4. Getting Started — Thresholds and Constants

**File:** `src/components/Group/HomeGettingStarted.tsx`

| Constant                | Value                       | Purpose                                                                                                                                   |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_BALANCE_FOR_QORTS` | `6`                         | Minimum QORT balance that marks step 1 ("Get your 6 QORT") as done.                                                                      |
| `GET_QORTS_URL`         | `'https://www.example.com'` | URL loaded in the iframe shown when the user clicks step 1. Replace with the real exchange / faucet URL.                                  |
| `LS_KEY`                | `'getting_started_status'`  | `localStorage` key used to persist completion. Set to `'completed'` once all 3 steps are done; the section then stays hidden permanently. |
| `AVATAR_SERVICE`        | `'THUMBNAIL'`               | QDN service used to check whether the user has an avatar.                                                                                 |
| `AVATAR_IDENTIFIER`     | `'qortal_avatar'`           | QDN identifier used for the avatar existence check.                                                                                       |

To reset the Getting Started section during development, clear the key from
`localStorage`:

```js
localStorage.removeItem('getting_started_status');
```

---

## 5. i18n Text

**Files:** `src/i18n/locales/<lang>/tutorial.json` → `home` object (all 12 locales)

All visible text in the Home page sections is controlled by the `home.*` keys inside
each locale's `tutorial.json`. The English master is at
`src/i18n/locales/en/tutorial.json`.

| Key | Used in | Default (EN) |
|---|---|---|
| `home.tab_user` | User/Developer tab switcher | `"User"` |
| `home.tab_developer` | User/Developer tab switcher | `"Developer"` |
| `home.getting_started` | Getting Started section title | `"Getting Started"` |
| `home.progress` | Step counter | `"{{completed}} / {{total}} completed"` |
| `home.get_six_qorts` | Getting Started step 1 label | `"Get your 6 QORT"` |
| `home.register_name` | Getting Started step 2 label | `"Register your name"` |
| `home.load_avatar` | Getting Started step 3 label | `"Load your avatar"` |
| `home.done` | Completed step button | `"Done"` |
| `home.open` | Pending step button | `"Open"` |
| `home.copy_address` | Address copy tooltip | `"Click to copy address"` |
| `home.address_copied` | Snackbar after address copy | `"Address copied to clipboard"` |
| `home.balance` | Balance label in profile card | `"Balance"` |
| `home.featured_apps` | Featured Apps section title | `"Featured Apps"` |
| `home.featured_groups` | Featured Groups section title | `"Featured Groups"` |
| `home.group_activity` | Group Activity section title | `"Group Activity"` |
| `home.developer_resources` | Developer tab section title | `"Developer Resources"` |
| `home.qtube_tutorial` | Developer card title | `"Q-Tube Tutorial"` |
| `home.qtube_tutorial_desc` | Developer card description | `"Learn how to publish and browse videos on Q-Tube"` |
| `home.core_support` | Developer card title | `"Qortal official CORE support"` |
| `home.core_support_desc` | Developer card description | `"Get help from the official Qortal CORE support group"` |
| `home.devnet_testing` | Developer card title | `"Q-App DevNet-Testing"` |
| `home.devnet_testing_desc` | Developer card description | `"Test your Q-Apps in the DevNet-Testing environment"` |

To change any visible label, edit the value for the matching key in every locale file.
The `postProcess: 'capitalizeFirstChar'` plugin capitalises the first character at
runtime, so values in the JSON should be all lowercase (except proper nouns).
