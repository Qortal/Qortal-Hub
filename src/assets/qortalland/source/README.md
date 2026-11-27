# QortalLand Source PNG Assets

Drop development PNG props in this folder while prototyping the QortalLand asset pipeline.

The current development loader auto-discovers files matching:

```text
src/assets/qortalland/source/**/*.png
```

Asset IDs are derived from the path below `source/` without the `.png` suffix.

Examples:

```text
source/technology/dj_booth_neon.png -> technology/dj_booth_neon
source/furniture/sofa_curved_magenta.png -> furniture/sofa_curved_magenta
```

To place a PNG in a room, add an entry to `QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS` in:

```text
src/components/QortalLand/QortalLand.tsx
```

Enable PNG prop overlays with either:

```js
localStorage.setItem('qortalland.devPngProps', '1');
```

or by adding this query parameter:

```text
?qortallandAssets=png
```

Disable overlays with:

```js
localStorage.removeItem('qortalland.devPngProps');
```

or:

```text
?qortallandAssets=procedural
```
