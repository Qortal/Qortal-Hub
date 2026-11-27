# QortalLand Asset Catalog

This document is the living production inventory for reusable QortalLand assets. It is not a runtime manifest yet; it exists to track what should be generated, reviewed, approved, and eventually packed into the production asset pipeline.

Use this catalog together with:

- `docs/qortalland-asset-standard.md`
- `docs/qortalland-style-prompt.md`

Source PNGs should live under `src/assets/qortalland/source/` using the category folders defined in the Asset Standard.

## Catalog Rules

- Keep asset IDs stable once assigned.
- Use snake_case filenames.
- Treat approved benchmark assets as sizing references for related future assets.
- Keep gameplay behavior, interaction rules, and room placement data outside this catalog.
- Add new assets here before generating large batches so naming and scale intent stay consistent.

## Status Values

| Status     | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| Planned    | Asset is intended but not generated yet.                                      |
| Draft      | Asset exists but still needs scale, style, transparency, or placement review. |
| Review     | Asset is being compared in-game against rooms and characters.                 |
| Approved   | Asset is accepted as part of the reusable source library.                     |
| Deprecated | Asset should no longer be used for new rooms.                                 |

## Furniture

| ID        | Filename                 | Status   | Notes                                                                           |
| --------- | ------------------------ | -------- | ------------------------------------------------------------------------------- |
| FUR_001   | bar_counter_long.png     | Approved | Reference furniture asset. Current scale benchmark for future furniture sizing. |
| FUR_002_T | sofa_modern_a_teal.png   | Review   | Modern Sofa A teal variant. Imported to replace Disco room procedural sofas.    |
| FUR_002_P | sofa_modern_a_purple.png | Review   | Modern Sofa A purple variant. Imported to replace Disco room procedural sofas.  |
| FUR_003   | bar_stool_round.png      | Review   | Bar stool group source asset. Five-stool Disco room group added to Asset Dev.   |
| FUR_004   | sofa_modern_b.png        | Planned  | Three-seat sofa.                                                                |
| FUR_005   | table_round_low.png      | Review   | Low round club table. Two Disco room placements added to Asset Dev.             |
| FUR_006   | park_bench_straight.png  | Review   | Straight futuristic Park bench. Added to Park room and Asset Dev.               |
| FUR_007   | park_bench_curved.png    | Review   | Curved futuristic Park bench. Added to Park room and Asset Dev.                 |

## Technology

| ID        | Filename               | Status | Notes                                                                                                                                                   |
| --------- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEC_001   | back_bar_unit_long.png | Review | Qortal Lounge back bar replacement for Disco room use. Sized against FUR_001.                                                                           |
| TEC_002   | dj_booth.png           | Review | Revised flatter camera-angle version imported for in-game placement on top of FUR_001. Converted from baked checkerboard background to transparent PNG. |
| TEC_003_L | speaker_left.png       | Review | Left-side nightclub speaker. Added to Disco room and Asset Dev as Speaker Left.                                                                         |
| TEC_003_R | speaker_right.png      | Review | Right-side nightclub speaker. Added to Disco room and Asset Dev as Speaker Right.                                                                       |

## Architecture

| ID        | Filename            | Status  | Notes                                                                                                |
| --------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| ARC_001   | club_floor.png      | Review  | Club room production floor candidate. Current Club layout now follows this floor's visual footprint. |
| ARC_002   | back_wall_main.png  | Review  | Main Club back wall candidate. Wired behind the bar for in-game review.                              |
| ARC_003   | wall_panel.png      | Planned | Modular wall element.                                                                                |
| ARC_004   | floor_tile_dark.png | Planned | Reusable floor tile.                                                                                 |
| ARC_005   | door_modern.png     | Planned | Transition doorway.                                                                                  |
| ARC_006   | club_wall_left.png  | Review  | Left Club side wall candidate. Added to Asset Dev for in-game placement review.                      |
| ARC_007   | club_wall_right.png | Review  | Right Club side wall candidate. Added to Asset Dev for in-game placement review.                     |
| ARC_008   | door_closed.png     | Review  | Club left-wall transition door closed frame. Added to Asset Dev as Club Door.                        |
| ARC_008_S | door_semi_open.png  | Review  | Club left-wall transition door semi-open frame for proximity animation.                              |
| ARC_008_O | door_open.png       | Review  | Club left-wall transition door open frame for proximity animation.                                   |

## Lighting

| ID      | Filename              | Status  | Notes                                                                     |
| ------- | --------------------- | ------- | ------------------------------------------------------------------------- |
| LGT_001 | ceiling_spotlight.png | Planned | Reusable club/theater ceiling light.                                      |
| LGT_002 | floor_light_bar.png   | Planned | Low floor accent light.                                                   |
| LGT_003 | dance_floor.png       | Review  | Neon dance floor panel. Added to Disco room and Asset Dev as Dance Floor. |

## Decorations

| ID      | Filename                      | Status   | Notes                                                                                                         |
| ------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| DEC_001 | neon_wall_sign_blank.png      | Planned  | Blank sign base for room-specific text variants.                                                              |
| DEC_002 | wall_poster_frame.png         | Planned  | Generic wall frame or poster holder.                                                                          |
| DEC_003 | planter_rect_tropical.png     | Review   | Wide tropical planter. Added to Disco room and Asset Dev as Planter Wide.                                     |
| DEC_004 | planter_tall_tropical.png     | Review   | Tall tropical planter. Added to Disco room and Asset Dev as Planter Tall.                                     |
| DEC_005 | qortal_neon_light.png         | Review   | Qortal neon wall sign. Cleaned to transparent PNG and added to Disco room / Asset Dev with warp controls.     |
| DEC_006 | park_planter_left.png         | Inactive | Older bottom-left Park planter/greenery asset. Removed from active Park room / Asset Dev in favor of DEC_012. |
| DEC_007 | park_bench_planter_left.png   | Review   | Combined curved bench and greenery planter for Park. Added to Park room and Asset Dev.                        |
| DEC_008 | park_tree_round_large.png     | Review   | Large round tree planter for Park. Added to Park room and Asset Dev.                                          |
| DEC_009 | park_tree_round_tall.png      | Review   | Tall round tree planter for Park. Added to Park room and Asset Dev.                                           |
| DEC_010 | park_tree_planter_lamp.png    | Review   | Tree planter with side flowers and lamp for Park. Added to Park room and Asset Dev.                           |
| DEC_011 | park_fountain_blue.png        | Review   | Blue holographic fountain for Park. Added to Park room and Asset Dev.                                         |
| DEC_012 | park_planter_row_trees.png    | Review   | Wide tree planter row for Park. Added to Park room and Asset Dev.                                             |
| DEC_013 | park_planter_corner_trees.png | Review   | Corner tree planter for Park. Added to Park room and Asset Dev.                                               |

## Animated

| ID      | Filename              | Status  | Notes                                                 |
| ------- | --------------------- | ------- | ----------------------------------------------------- |
| ANI_001 | disco_light_sweep.png | Planned | Candidate for future sprite sheet or atlas animation. |

## Backgrounds

| ID      | Filename            | Status  | Notes                                                                               |
| ------- | ------------------- | ------- | ----------------------------------------------------------------------------------- |
| BKG_001 | club_wall_plate.png | Planned | Optional room-specific wall/background plate if modular wall pieces are not enough. |

## Characters

| ID      | Filename                     | Status  | Notes                                                                         |
| ------- | ---------------------------- | ------- | ----------------------------------------------------------------------------- |
| CHR_001 | avatar_default_reference.png | Planned | Optional visual reference export for comparing prop scale against the player. |
