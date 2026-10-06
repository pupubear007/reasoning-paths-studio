# Reasoning Paths Studio

An interactive 3D sketch that draws "reasoning" as trajectories in space:

- **Deductive** paths take fixed Cartesian steps (Δx, Δy, Δz) from a starting point. They are lines.
- **Inductive** paths wander on a sphere (Δθ, Δφ) with Gaussian noise on the radius that shrinks with each iteration.
- **Chaotic** instances are deterministic point clouds driven by your own expressions of `i`, `t` and `m`, with any number of named intermediate variables.
- **Beyond paths**: parametric curves γ(t), explicit surfaces z = f(x, y), implicit surfaces f(x, y, z) = 0 (marching cubes), vector fields, and ray-marched volume clouds.

It is built on [three.js](https://threejs.org/) r160 and ships as one self-contained HTML file. This repository holds version 9 of the studio, which was first developed in [`pupubear007/RPwalk`](https://github.com/pupubear007/RPwalk).

## Running it

**Online:** https://pupubear007.github.io/reasoning-paths-studio/ (published from `main` by GitHub Actions).

**Locally:** open `index.html` in a recent desktop browser (Chrome, Edge, Firefox or Safari). There is no build step.

- Volume clouds need WebGL2.
- three.js and the web fonts load from CDNs (`unpkg.com`, `fonts.googleapis.com`), so the first load needs internet access.
- To serve it locally instead, run `npx serve .` or `python3 -m http.server`, then open the printed URL.

## Using it

| Area | What it does |
| --- | --- |
| **Variables** panel | Eight shared scalars (`l m n p q r c d`). Click **ƒx** next to any numeric field to bind it to an expression of those variables. |
| **Deductive / Inductive / Chaotic** panels | Add, duplicate, rename, recolor, float or delete instances. **Load CSV** and **Export CSV** round-trip each kind; see `examples/`. |
| **Walk** panel | Random walks over any set of parameters or variables, run all at once or in turn. Turn on a card's *Movement track* to keep ghost trails of past frames. |
| **Equations** panel | A read-only symbolic readout of every instance, with ƒx expressions and their resolved values. |
| **Beyond paths** panel | Curves, surfaces, vector fields and volumes. All accept the same expression syntax, including the shared variables. |
| Toolbar | Reseed, grid/axes/shadow toggles, zoom, auto-orbit, **↶ undo / ↷ redo** (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z), PNG export, project save/load (JSON), **🔗 share link**, **✧ Surprise me**, and clear canvas. Click the *autosave* label to turn on autosave: the session is then saved to this browser and reopened the next time you load the page. |

### Sharing a scene

Click **🔗** to copy a link that contains the whole scene (instances, variables, expressions, Beyond objects and display settings), compressed into the URL fragment. Opening the link recreates the scene. The fragment is never sent to a server, so links work from GitHub Pages and from a local copy alike. Shared scenes are treated as untrusted input: every value is type-checked and capped before it's used.

### Expression syntax

`+ - * / ^` (or `**`), parentheses, and these functions:
`sin cos tan asin acos atan sec csc cot asec acsc acot sinh cosh tanh asinh acosh atanh sech csch coth asech acsch acoth sqrt abs exp ln log sgn hypot(a,b) mag(a,b) atan2(y,x)`.
The constants are `e`, `pi` and `π`. Expressions go through a small whitelist parser, so user text is never passed to `eval`.

### Limits

Deductive steps and inductive iterations are capped at 5,000 points per path, and Chaotic iterations at 200,000. Larger values, whether typed, computed by an ƒx expression, walked or imported, are clamped.

### CSV format

```
id,start_x,start_y,start_z,x_inc,y_inc,z_inc,steps,ded_polarity
A,0,0,0,0.05,0.02,0.01,20,up
```

```
id,start_r,start_theta,start_phi,theta_inc,phi_inc,sigma,iterations,ind_polarity
E,1,1.5708,0,0.05,0.08,0.1,30,positive
```

Chaotic CSVs use `id,defs,x_expr,y_expr,z_expr,iterations,m_values,param_t_speed,local_t,show_line,show_points,preset`. The easiest way to get one is **Export CSV** on the Chaotic panel.

## Development

```bash
npm install          # installs three@0.160.0 and Playwright (for tests only)
npm test             # expression-engine unit tests + headless browser smoke test
```

The smoke test opens `index.html` in headless Chromium and serves three.js from `node_modules`, so it works without CDN access. Run `npx playwright-core install chromium` once to download the browser, or set `CHROMIUM_PATH` to point at an existing Chrome or Chromium.

GitHub Actions runs the tests on every push and pull request (`.github/workflows/test.yml`) and deploys `main` to GitHub Pages (`.github/workflows/pages.yml`).

## License

Apache-2.0 — see [LICENSE](LICENSE).
