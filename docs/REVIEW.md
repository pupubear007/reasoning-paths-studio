# Code review: Reasoning Paths Studio v9

The review covers `RP_Walk_parametric_v9.html` from `pupubear007/RPwalk`, which became `index.html` here. That's about 10,500 lines: about 1,400 of CSS, 500 of markup and 8,200 of JavaScript in one ES module, plus a small theme-switcher script. Line numbers below refer to `index.html` after the fix commit.

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

## Still open (not changed)

These need design decisions or bigger edits than a review-fix commit should make.

### Correctness

1. **Project load is not a clean replace** (`loadFullProject`, line 5913).
   - It empties the instance arrays but **doesn't remove existing `.inst-card` DOM nodes**, so loading appends duplicate cards. The old cards stay wired to disposed instances.
   - The first loaded ded/ind instance becomes "primary" with `params: null`, so if the saved first instance was a secondary, **its saved params are silently replaced by `state`**.
   - The static primary cards stay wired, through closures, to the *old* `PRIMARY_DED` / `PRIMARY_IND` objects. After a load, their color picker, track toggles and ✕ act on dead objects. ✕ removes the card while the path keeps rendering.
   - Beyond instances are dropped from their arrays, but their `sceneGroup`s are never removed from the scene. **Old surfaces and fields stay visible and can't be deleted.**
   - `Object.assign(state, project.state)` restores `animate`, `showGrid` and similar flags without updating the toolbar buttons.
   - Suggested fix: route load through `clearCanvas()` first, then rebuild every instance as a secondary (or build the primary's card dynamically like the others).
2. **Autosave never restores.** `tryRestoreAutosave` (line 6214) is defined but never called, so enabling autosave only writes to `localStorage`. Fix item 1 before wiring it up, or every restore will hit the duplicate-card problems.
3. **The first-run welcome scene is dead code** (line 10076). The guard `instances > 1` is always true at boot because two primaries exist. If it ever ran, it would also append the card *before* setting the params, so the card would show jellyfish defaults while the scene showed something else.
4. **The Surprise "support" path can come out wrong** (line 6515). `makeInstance('ded')` returns a *primary* when the list is empty and the primary wasn't deleted (for example, after a project load with no ded instances). Its assigned `params` are then ignored, because primaries read from `state`.
5. **`resize()` (line 3754) only updates `LineMaterial.resolution` under `dedGroup` and `indGroup`.** Movement tracks (`tracksRoot`) and Beyond parametric curves keep the old resolution, so their line widths are off after a window resize until rebuilt.
6. **"attractor_garden" Surprise scenes fall far outside the ±2 cube.** `y = b*1.55 + dy*55` with `dy ≈ a·(22…34)·0.028` gives |y| of about 40–60.
7. Minor parser leniency: `1.2.3` parses as `1.2`, and one-argument functions silently ignore a second argument (`sin(1, 2)`).

### Performance

8. **Every `regenerate()` rebuilds every Chaotic instance from scratch** (lines 3636, 3651): recompiling via `new Function`, reallocating buffers, and refilling 10k–30k points. Walks call `regenerate()` on every tick (every 120 ms by default) even though walks never touch Chaotic params. Rebuild a Chaotic instance only when its own params change.
9. **The Chaotic line overlay reallocates every frame** (line 2781). `setPositions(Array.from(positions3))` creates new interleaved buffers, and the old GPU buffers aren't freed until the geometry is disposed. Update the existing instance attribute in place.
10. **`buildPath` clones a sphere geometry per marker** and never disposes the template (line 3319). With large `steps` (walks can push it upward without limit) that's thousands of meshes per rebuild. An `InstancedMesh` would be far cheaper.
11. **`steps` / `iterations` have no upper bound** from the free inputs or from ƒx expressions (`quantize` only enforces ≥ 1). Typing `1e7` freezes the tab.
12. **The Beyond variable watcher polls `state.vars` every 250 ms** (line 9841) and rebuilds *all* Beyond objects, including marching cubes (up to 81³ interpreted evaluations) and volumes, whenever any variable changes, for example during a `var_*` walk.

### Maintainability

13. **Dead code:** `generateCreativeExpressions`, `POETIC_NAMES`, `getPoeticName` and `generateSurpriseColor` (about 150 lines from line 6670), `drawMini`, `parseUnary`, `findInstance`, and the vestigial `state.animateParam` / `paramT`. The legacy `generateCreativeExpressions` also uses the reserved names `t` and `m`.
14. **Monkey-patching by reassigning function declarations** (`regenerate`, `animate`, `renderEquationsPanel`, `recomputeAllSecondaryExpressions`) works, but makes it hard to follow what runs. An explicit hook list would be clearer.
15. **The primary/secondary split** (primary params live in `state`, with bare DOM ids and static markup) causes most of the bugs above and the duplicated card-building code. Building the primary cards dynamically, with a `params` object like every other instance, would remove the `*PrimaryDisposed` flags and most of the "skip primary by flag" special cases.
16. **Card HTML is grouped by splitting a template string on `'</div>'`** (`buildInstanceCardHTML`). This breaks as soon as a field row gains a nested `div`.
17. **The volume shader's opacity correction** `pow(1 - a, dt*steps*0.5)` is constant per ray, not per step, so it doesn't make opacity independent of step count as the comment claims.

## Tests added

- `tests/engine.test.mjs`: the parser, precedence, functions, codegen matching the interpreter, name validation, the `defs` CSV encoding, and compiling every Surprise scene. This catches #1.
- `tests/smoke.test.mjs`: headless Chromium boot with no page errors, the add/duplicate buttons, Surprise, the project-save fade expression, and walks. This catches #2 and #3.

Against the original v9, 3 of the 12 tests fail. After the fixes, all 12 pass.
