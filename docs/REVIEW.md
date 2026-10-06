# Code review: Reasoning Paths Studio v9

The review covers `RP_Walk_parametric_v9.html` from `pupubear007/RPwalk`, which became `index.html` here. That's about 10,500 lines: about 1,400 of CSS, 500 of markup and 8,200 of JavaScript in one ES module, plus a small theme-switcher script. Line numbers below refer to the current `index.html`.

## What's solid

- **Expression engine (`tokenize`, line 2085 onward).** A real recursive-descent parser over a whitelist of functions and constants, with correct precedence (`-2^2 = -4`, `^` right-associative). The Chaotic fast path compiles the *validated AST* to JS with `new Function`, never the user's source text, and intermediate names must match `^[a-z_][a-z0-9_]*$` and avoid reserved names. I found no way to inject code through an expression.
- **Chaotic hot loop.** A preallocated `Float32Array` is refilled in place each frame, with no per-frame allocation when the line overlay is off.
- **Marching cubes.** Standard Lorensen–Cline tables, vertices shared between neighboring cells for smooth normals, and NaN treated as "outside".
- **Walk engine.** Per-parameter ownership across several walk instances, anchors for each secondary instance, and a `try/finally` so a bad tick can't silently stop the walk.
- **Comments.** Most non-obvious decisions are explained where they're made.

## Fixed in this repository (commit 2)

| # | Severity | Issue |
|---|---|---|
| 1 | High | The **"spiral_bloom" Surprise scene never rendered.** It defined an intermediate named `m`, which is reserved, so `chaoticCompile` threw and every point stayed at the origin. That's about 1 in 5 Surprise clicks, plus the dormant first-run welcome scene. |
| 2 | High | **Project save lost the movement-track fade expression.** `serializeInstance` wrote `track.fadeVar` (always `undefined`) instead of `track.fadeVarExpr`. |
| 3 | High | **On first load, the Chaotic panel covered the Deductive panel's + Add / Duplicate / Load CSV buttons.** `positionSidePanels` gave every panel a default position except `chaos_panel`. |
| 4 | Medium | **Changing a walk's direction mid-run set variable params to NaN.** The re-anchor read `state[p]` instead of `readParam(p)`, which is undefined for `var_*`. |
| 5 | Medium | **"Reset all" walks could skip a secondary instance.** The snapshot used `slice(1)` to skip the primary, so once the primary card was deleted, the first secondary was never restored. |
| 6 | Medium | **Chaotic CSV rows without optional columns rendered nothing,** because missing `show_points` became `false`. Defaults are now merged in. |
| 7 | Medium | **Markup injection from a loaded project file.** `inst.color` and `track.fadeVarExpr` were interpolated into `innerHTML` unescaped. Colors are now normalized to `#rrggbb` and the fade expression is escaped. |
| 8 | Low | Renaming a Chaotic card relabelled it "Inductive · NN". |
| 9 | Low | Reseed and Clear canvas each had two click listeners. |

## Fixed in the follow-up (branch `claude/bold-fermat-sua9vx`)

| Former open item | Change |
|---|---|
| Project load wasn't a clean replace | `resetScene()` tears down cards (docked and floating), meshes, Beyond objects and walks. `loadFullProject()` then rebuilds every instance as an ordinary card, converts the legacy state-backed primary from `project.state`, keeps ids, and syncs the toolbar. |
| Autosave never restored | The last session is restored at startup when autosave is on. |
| Preset threw after Clear canvas | It now falls back to the first deductive / inductive card. |
| Chaotic clouds rebuilt on every `regenerate()` | Rebuilt only when their own inputs change: 23.1 ms → 9.8 ms per walk tick with four 10k-point clouds. Paused clouds are no longer refilled every frame. |
| Line overlay reallocated every frame | Updated in place. |
| A cloned sphere mesh per path marker | One `InstancedMesh` per path. |
| No upper bound on steps / iterations | Capped at 5,000 points per path and 200,000 Chaotic iterations. |

## Still open (not changed)

These need design decisions or bigger edits than a review-fix commit should make.

### Correctness

1. **The first-run welcome scene is dead code** (line 10158). The guard `instances > 1` is always true at boot because two primaries exist. If it ever ran, it would also append the card *before* setting the params, so the card would show jellyfish defaults while the scene showed something else.
2. **`resize()` (line 3813) only updates `LineMaterial.resolution` under `dedGroup` and `indGroup`.** Movement tracks (`tracksRoot`) and Beyond parametric curves keep the old resolution, so their line widths are off after a window resize until rebuilt.
3. **"attractor_garden" Surprise scenes fall far outside the ±2 cube.** `y = b*1.55 + dy*55` with `dy ≈ a·(22…34)·0.028` gives |y| of about 40–60.
4. Minor parser leniency: `1.2.3` parses as `1.2`, and one-argument functions silently ignore a second argument (`sin(1, 2)`).

### Performance

5. **The Beyond variable watcher polls `state.vars` every 250 ms** (line 9920) and rebuilds *all* Beyond objects, including marching cubes (up to 81³ interpreted evaluations) and volumes, whenever any variable changes, for example during a `var_*` walk.

### Maintainability

6. **Dead code:** `generateCreativeExpressions`, `POETIC_NAMES`, `getPoeticName` and `generateSurpriseColor` (about 150 lines from line 6748), `drawMini`, `parseUnary`, `findInstance`, and the vestigial `state.animateParam` / `paramT`. The legacy `generateCreativeExpressions` also uses the reserved names `t` and `m`.
7. **Monkey-patching by reassigning function declarations** (`regenerate`, `animate`, `renderEquationsPanel`, `recomputeAllSecondaryExpressions`) works, but makes it hard to follow what runs. An explicit hook list would be clearer.
8. **The primary/secondary split** (primary params live in `state`, with bare DOM ids and static markup) causes most of the bugs above and the duplicated card-building code. Building the primary cards dynamically, with a `params` object like every other instance, would remove the `*PrimaryDisposed` flags and most of the "skip primary by flag" special cases.
9. **Card HTML is grouped by splitting a template string on `'</div>'`** (`buildInstanceCardHTML`). This breaks as soon as a field row gains a nested `div`.
10. **The volume shader's opacity correction** `pow(1 - a, dt*steps*0.5)` is constant per ray, not per step, so it doesn't make opacity independent of step count as the comment claims.

## Tests added

- `tests/engine.test.mjs`: the parser, precedence, functions, codegen matching the interpreter, name validation, the `defs` CSV encoding, and compiling every Surprise scene. This catches #1.
- `tests/smoke.test.mjs`: headless Chromium boot with no page errors, the add/duplicate buttons, Surprise, the project-save fade expression, and walks. This catches #2 and #3.

Against the original v9, 3 of the 12 tests fail. After the fixes, all 12 pass.

The follow-up adds 5 more smoke tests: project save → load (twice), Clear canvas followed by Preset, autosave restore across a reload, the point-count caps, and animating a Chaotic cloud with the line overlay.
