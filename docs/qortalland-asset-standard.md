# QortalLand Asset Standard v1.0

## Purpose

QortalLand should move from rooms drawn directly with Phaser `Graphics` toward a reusable internal asset library. Future rooms such as Disco, Cinema, Q-Tube, Arcade, Library, and related spaces should be assembled from shared transparent PNG source assets, compiled runtime atlases, and room layout data.

This standard is intended for developers, artists, AI tools, and Codex. It is not a user-created-room format. It is an internal production standard for building official QortalLand rooms consistently.

For visual language, AI generation prompts, material guidance, and style constraints, see `docs/qortalland-style-prompt.md`.

## Current Implementation Baseline

The current QortalLand implementation lives primarily in `src/components/QortalLand/QortalLand.tsx`.

Current behavior:

- Rooms are drawn manually with Phaser `Graphics`.
- The only image asset loaded by QortalLand is `src/assets/qortalland/default-character-spritesheet.png`.
- Character animation uses a spritesheet with 320x320 frames.
- Room layout, visual drawing, movement bounds, room transitions, and interactions are currently defined in code.
- The Phaser world uses a logical coordinate space of 1800x820.
- The Phaser canvas uses `Phaser.Scale.RESIZE`; image scale and placement still need to be controlled explicitly.
- The visual perspective is front-facing 2.5D, not isometric.
- Object depth is a mix of fixed layer depths and Y-based avatar depth.
- Collisions are not object-based yet. Movement is clamped to room floor bounds.
- Interactions are code-defined hotspots, not sprite-attached behavior.

This standard is compatible with the current implementation, but it requires a migration layer before rooms can be fully data-driven.

## Core Principles

- Rooms are rectangular, full-screen, front-facing 2.5D spaces.
- Do not use isometric diamond maps.
- Prefer reusable assets whenever practical.
- Keep artwork, room layout, collision, transitions, and interaction hotspots separate.
- Use individual PNG files during rapid development.
- Compile stable reusable assets into texture atlases for runtime.
- Keep large unique room plates or hero backdrops as individual PNGs when atlas packing would be awkward or wasteful.
- Preserve character spritesheets unless and until the character animation system is redesigned.

## Visual Style

- Clean cartoon/vector aesthetic.
- Readable silhouettes at gameplay scale.
- Bright accents with restrained neon/futuristic lighting.
- Consistent front-facing 2.5D perspective.
- Transparent backgrounds for reusable props.
- Avoid assets that only read correctly from an isometric viewpoint.
- Use clear contact shadows or anchor points so props feel grounded on the floor.

## Coordinate And Size Standard

QortalLand rooms should use the existing logical world size unless there is a deliberate engine change:

- World width: `1800`
- World height: `820`
- Room art should be designed against this coordinate system.
- Full-room background plates should be `1800x820` when used.
- Reusable props should be authored close to their intended in-game pixel size.
- Phaser can scale sprites, but default placement should assume scale `1` for crisp iteration.

For props, include an anchor convention in the manifest:

- `originX`: usually `0.5`
- `originY`: usually `1` for floor-standing props
- `footY`: the local pixel row that represents the prop's floor contact point when `originY` is not enough

## Asset Categories

Recommended source categories:

- `architecture`: walls, floors, doors, windows, pillars, railings
- `furniture`: bars, sofas, chairs, tables, counters, shelves
- `technology`: DJ booths, screens, speakers, kiosks, arcade cabinets
- `lighting`: spotlights, disco balls, neon signs, light strips
- `decorations`: plants, clocks, paintings, trash bins, rope barriers
- `animated`: animated lights, displays, arcade loops, signs
- `characters`: character spritesheets and future avatar parts
- `backgrounds`: unique full-room plates or large room-specific backdrops

## Folder Structure

Use `src/assets/qortalland` as the root for QortalLand assets.

Recommended structure:

```text
src/assets/qortalland/
  source/
    architecture/
    furniture/
    technology/
    lighting/
    decorations/
    animated/
    characters/
    backgrounds/
  atlases/
    qortalland-props.png
    qortalland-props.json
    qortalland-animated.png
    qortalland-animated.json
  manifests/
    assets.ts
  layouts/
    club.ts
    cinema.ts
    qtube.ts
    arcade.ts
    library.ts
  concepts/
  reference/
```

The exact atlas filenames can change as tooling evolves, but source assets, generated runtime assets, manifests, and layouts should remain clearly separated.

## File Standards

Source props:

- Format: PNG
- Color: RGBA
- Background: transparent
- Naming: snake_case
- One logical prop per file
- Avoid baked-in floor shadows unless the asset always sits on the same floor
- Prefer consistent padding around assets so atlas trimming does not break visual alignment

## Contact Shadows

Reusable source PNGs should not bake large floor or surface shadows into the artwork. A prop may be placed on different surfaces in different rooms, so contact shadows that depend on placement should be defined by room/layout metadata.

Use layout-defined contact shadows for:

- Furniture with visible feet or gaps underneath.
- Objects resting on another object, such as a DJ booth on a bar counter.
- Props that need a small grounding cue to avoid looking like they float.

Keep these shadows subtle:

- Soft dark ellipse or similar simple shape.
- Rendered just beneath the prop.
- Depth slightly below the prop but above the supporting surface.
- Small enough to read as contact, not room lighting.

Small object-local occlusion inside the PNG is still acceptable when it is part of the object itself, such as under a cushion edge, inside a shelf, or beneath a built-in foot.

Examples:

```text
bar_counter_long.png
dj_booth_neon.png
speaker_stack_tall.png
sofa_curved_magenta.png
neon_strip_cyan_horizontal.png
arcade_cabinet_qortal_idle.png
```

Large unique art:

- Full-room plates and very large hero pieces may remain individual PNGs.
- Name them with room context, such as `club_background_v1.png` or `cinema_screen_wall.png`.

## Runtime Pipeline

Preferred long-term pipeline:

```text
source PNGs -> generated texture atlases -> asset manifest -> room layout -> Phaser scene
```

Development mode may load individual PNGs directly for quick iteration. Production should prefer atlases for shared props and animated assets.

Important current-code caveat:

- QortalLand currently uses `Phaser.CANVAS`, not WebGL.
- Atlases are still useful for organization and fewer runtime assets, but the largest rendering gains may come later if QortalLand moves to WebGL.

## Development PNG Loader

The first migration bridge is a simple individual-PNG loader in `src/components/QortalLand/QortalLand.tsx`.

It discovers:

```text
src/assets/qortalland/source/**/*.png
```

Asset IDs are generated from paths relative to `source/`:

```text
source/technology/dj_booth_neon.png -> technology/dj_booth_neon
```

Manual placements are defined in `QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS`.

Enable development PNG prop overlays with:

```js
localStorage.setItem('qortalland.devPngProps', '1');
```

or:

```text
?qortallandAssets=png
```

Disable the overlay with:

```js
localStorage.removeItem('qortalland.devPngProps');
```

or:

```text
?qortallandAssets=procedural
```

This loader is intentionally not the final production asset system. It exists so prop scale, style, transparency, and placement can be validated before atlas and manifest tooling are introduced.

## Asset Manifest

Every runtime asset should have a manifest entry. A typed TypeScript manifest is preferred initially because the app is Vite/React/TypeScript and static imports are easier to validate than raw JSON paths.

Recommended manifest shape:

```ts
type QortalLandAssetDefinition = {
  id: string;
  category: string;
  source?: string;
  atlas?: string;
  frame?: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  footY?: number;
  defaultDepth?: number;
  ySort?: boolean;
  tags?: string[];
};
```

The manifest should avoid gameplay behavior. It describes visual assets and placement defaults only.

## Room Layouts

Rooms should eventually be assembled from layout data instead of direct drawing functions.

Typed TypeScript layouts are recommended for the first migration phase. JSON can be introduced later if external tooling needs it.

Recommended room layout shape:

```ts
type QortalLandRoomLayout = {
  id: string;
  world: {
    width: 1800;
    height: 820;
  };
  background?: string;
  floor: {
    walkablePolygon?: Array<{ x: number; y: number }>;
    scaleByY?: {
      topY: number;
      bottomY: number;
      minScale: number;
      maxScale: number;
    };
  };
  layers: QortalLandLayer[];
  objects: QortalLandObjectInstance[];
  hotspots: QortalLandHotspot[];
  transitions: QortalLandTransition[];
};
```

Object instance:

```ts
type QortalLandObjectInstance = {
  id: string;
  assetId: string;
  x: number;
  y: number;
  scale?: number;
  flipX?: boolean;
  depth?: number;
  depthMode?: 'fixed' | 'y-sort';
  visible?: boolean;
};
```

## Layering And Depth

The current scene uses these broad depth ideas:

- background graphics around `-100`
- animated light sweeps around `-80`
- fixed prop layers such as `370`, `480`, `545`, `620`, `665`
- avatars at `y + 20`
- labels at `y + 90`
- chat bubbles and prompts above gameplay objects

Future layouts should make depth explicit:

- Use fixed depth for walls, back bars, ceiling lights, background panels, and room plates.
- Use Y-sort depth for floor-standing objects that characters can visually pass in front of or behind.
- Store depth behavior in the object instance or asset defaults.

Recommended depth bands:

```text
-200 to -101: static room background plates
-100 to  -81: generated or static background details
 -80 to  -61: ambient animated lighting
   0 to  299: far/background props
 300 to  599: mid-room props
 600 to  899: foreground props
 y+20: avatars and Y-sorted floor objects
9000+: prompts, labels, chat bubbles, debug overlays
```

## Collision And Walkable Areas

Do not infer collision from image bounds.

Current QortalLand only clamps movement to calculated floor bounds. The asset pipeline should introduce explicit movement data:

- walkable polygons for room floors
- optional blocked rectangles/polygons for large props
- transition zones for doors/portals
- interaction zones for hotspots

Collision should be stored separately from visual assets and should be editable without changing artwork.

Initial v1 collision scope:

- Keep existing floor-bound movement if needed.
- Add data-defined transition zones and interaction zones first.
- Add per-object blockers later only when the room design needs them.

## Interactive Objects

Interactions should be defined as hotspots, not as behavior embedded in sprite images.

Recommended hotspot shape:

```ts
type QortalLandHotspot = {
  id: string;
  label: string;
  kind: 'inspect' | 'transition' | 'activity' | 'future';
  x: number;
  y: number;
  radius?: number;
  rect?: { x: number; y: number; width: number; height: number };
  prompt?: string;
  enabled?: boolean;
};
```

Example:

```ts
{
  id: 'club.dj_booth',
  label: 'DJ Booth',
  kind: 'future',
  x: 900,
  y: 374,
  radius: 148,
  prompt: '[E] Interact',
  enabled: true,
}
```

The visible sprite and the hotspot may share a conceptual ID, but they should remain separate data entries.

## Animation

Static PNGs are preferred for v1 props.

Use spritesheets or atlas frames for:

- blinking signs
- screens
- arcade cabinets
- disco lights
- machinery
- active/inactive object states

Animated assets should include metadata:

```ts
type QortalLandAnimationDefinition = {
  id: string;
  assetId: string;
  frames: string[];
  frameRate: number;
  repeat: number;
};
```

Do not require animation for decorative props in v1.

## Floors And Walls

Use a hybrid approach:

- Modular floors and walls should provide reusable room construction pieces.
- Unique room background plates and overlays are allowed when they give a room identity.
- Avoid making every room a completely bespoke painting.
- Avoid making every room feel assembled from identical tiles.

Recommended approach:

- Shared base floor materials: dark club floor, polished mall floor, carpet, library wood, arcade tile.
- Shared wall modules: panels, trim, doors, windows, pillars, neon strips.
- Room-specific hero overlays: cinema screen wall, Q-Tube stage, disco bar, arcade prize wall, library shelving.

## Current Feature Scope

For v1:

- Static props only by default.
- Character sprites remain spritesheets.
- Doors and portals are transition hotspots.
- Chairs and sofas are decorative only.
- No required sitting behavior.
- No required per-object collision.
- No user-created rooms.
- Layouts may be TypeScript before they become JSON.

## Migration Plan

Recommended migration sequence:

1. Extract current procedural room constants into room layout data.
2. Add an asset manifest and preload helper while keeping procedural drawing.
3. Replace one low-risk prop category with PNG assets, such as speakers or plants.
4. Add hotspot data for existing interactions, including the DJ booth.
5. Replace the Disco room's large props with reusable assets.
6. Add generated texture atlas support after the source PNG set stabilizes.
7. Move full room assembly to data-driven layouts.
8. Repeat for Cinema, Q-Tube, Arcade, Library, and later rooms.

## Risks And Constraints

- Large transparent PNGs can waste memory if packed carelessly.
- Atlas trimming can break expected origins if manifests do not store origin and foot point metadata.
- A room made only from modular assets may feel generic without room-specific hero pieces.
- Data-defined layouts need validation; silent typos in asset IDs or frame names will otherwise become runtime missing art.
- Current movement is not object-collision-aware, so adding solid-looking furniture before blockers may confuse players.
- The current Phaser canvas renderer may limit benefits from atlas batching compared with WebGL.
- Scaling assets too far from source size can make the visual language inconsistent.

## Validation Requirements

Before a new asset or layout is accepted:

- Asset IDs are unique.
- Referenced source files or atlas frames exist.
- Origins and foot points are defined for floor-standing props.
- Layout objects reference valid asset IDs.
- Hotspots and transitions are separate from visual object entries.
- Room layouts use the 1800x820 coordinate space unless explicitly documented.
- A screenshot pass confirms no major layering, scale, or perspective issues.

## Notes For Codex

- Prefer individual PNG loading during rapid iteration.
- Do not bake gameplay behavior into asset images.
- Keep rendering, collisions, interactions, transitions, and room layout decoupled.
- Prefer typed TypeScript layout and manifest data until dedicated asset tooling exists.
- When generating assets, produce transparent PNG source files with stable snake_case names.
- Once assets stabilize, pack shared props into texture atlases and update the manifest instead of changing room layout semantics.
