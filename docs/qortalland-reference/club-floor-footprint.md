# Club Floor Footprint Reference

Room dimensions: `1800 x 820`

## Production Floor Footprint

This is the visible Club floor trapezoid currently drawn by QortalLand.

| Corner | X    | Y   | Notes                    |
| ------ | ---- | --- | ------------------------ |
| A      | 205  | 300 | Back-left floor corner   |
| B      | 1595 | 300 | Back-right floor corner  |
| C      | 1725 | 690 | Front-right floor corner |
| D      | 75   | 690 | Front-left floor corner  |

Polygon order:

```text
(205, 300)
(1595, 300)
(1725, 690)
(75, 690)
```

## Player-Feet Movement Clamp

The player is clamped slightly inside the visible floor. This is the effective walkable area for the avatar feet.

| Corner | X        | Y   | Notes                      |
| ------ | -------- | --- | -------------------------- |
| A      | 232      | 324 | Back-left movement clamp   |
| B      | 1568     | 324 | Back-right movement clamp  |
| C      | 1680.667 | 662 | Front-right movement clamp |
| D      | 119.333  | 662 | Front-left movement clamp  |

Polygon order:

```text
(232, 324)
(1568, 324)
(1680.667, 662)
(119.333, 662)
```

## Reference Images

- `club-floor-footprint-reference.png`: plain dark background, labeled corners.
- `club-floor-footprint-transparent.png`: transparent overlay with only the footprint and movement clamp.
