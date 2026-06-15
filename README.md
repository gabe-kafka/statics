# statics

A 2D-frame structural-analysis tool. Two surfaces:

- **Web app** at <https://statics.kafkadesign.io> — interactive editor for nodes, members, supports, loads, and material properties; renders FBD, V(s), M(s), θ(s), Δ(s) live in the conjugate-method notebook palette.
- **HTTP API** at `/api/v1/solve` — stateless direct-stiffness solver. POST a structural problem, receive reactions, member end-forces, member local-axis directions, and sampled V/M/θ/Δ along each member. Optional pre-rendered SVG diagrams.

## API

Interactive reference: <https://statics.kafkadesign.io/docs>
OpenAPI spec: <https://statics.kafkadesign.io/api/v1/openapi.json>

### Quick example

```bash
curl -X POST https://statics.kafkadesign.io/api/v1/solve \
  -H 'Content-Type: application/json' \
  -d '{
    "nodes": [[0,0],[15,0],[31,0]],
    "members": [
      {"i":0,"j":1,"E":29000,"I":100,"A":10},
      {"i":1,"j":2,"E":29000,"I":100,"A":10}
    ],
    "supports": [
      {"node":0,"Rx":true,"Ry":true,"Rm":false},
      {"node":2,"Rx":false,"Ry":true,"Rm":false}
    ],
    "pointLoads": [{"node":1,"Fx":0,"Fy":-10,"M":0}],
    "distLoads": [
      {"member":0,"wi":-2.98,"wj":-2.98},
      {"member":1,"wi":-3.50,"wj":-5.64}
    ]
  }'
```

Response (truncated):

```jsonc
{
  "ok": true,
  "reactions": [
    { "node": 0, "Rx": 0, "Ry": 56.44, "M": 0 },
    { "node": 2, "Rx": 0, "Ry": 71.38, "M": 0 }
  ],
  "members": [
    { "i": 0, "j": 1, "L": 15, "c": 1, "s": 0, "endForces": {...}, "samples": [...] }
  ],
  "peaks": {
    "V":     { "value":  71.38, "x": 31, "member": 1, "sLocal": 16 },
    "M":     { "value": 412.50, "x": 15, "member": 0, "sLocal": 15 },
    "theta": { "value":  -0.0021, "x": 0, "member": 0, "sLocal": 0 },
    "delta": { "value":  -0.0184, "x": 18.7, "member": 1, "sLocal": 3.7 }
  }
}
```

Pass `"include": ["data", "svg"]` to also receive the rendered diagrams as SVG strings (FBD, V, M, θ, Δ, plus a stacked `all`).

Use `hinges` for explicit member-end moment releases:

```json
{ "hinges": [{ "member": 0, "end": "i" }, { "member": 0, "end": "j" }] }
```

Use `pointSprings` for nodal ground springs and `uniformSprings` for
member-local transverse foundation stiffness. The uniform spring `k` is a
distributed stiffness: force per transverse deflection per member length
(for example, `kip/in/ft`):

```json
{
  "pointSprings": [{ "node": 1, "Kx": 0, "Ky": 100, "Km": 0 }],
  "uniformSprings": [{ "member": 0, "k": 25 }]
}
```

In the web app, load cases and load combinations are table-driven. `LOAD CASES`
uses `(case, label)`, `LOAD COMBINATIONS` uses one row per term
`(combo, case, factor)`, and point/distributed load rows end with a `case`
column. The `RUN` control prompts for the combination name to analyze.

### Sign convention

World `+y` is up. Loads given in `+y`; downward loads are negative. Point-load `M` is a nodal moment, positive counterclockwise. Units pass through (kip / in / ksi works; the solver doesn't enforce them). Each member's `E`, `I`, and `A` are honored independently as `E·I` and `E·A`; mixed sections are supported.

### Failure modes

The `error` field is a stable machine-readable code. Switch on it in clients without parsing `message`.

| Code | Meaning |
| --- | --- |
| `invalid_input` | Malformed JSON or out-of-range references. |
| `degenerate_member` | Zero-length member or `i == j`. |
| `non_positive_section` | `E`, `I`, or `A` not strictly positive. |
| `insufficient_supports` | Fewer than 3 restrained DOFs across all supports. |
| `no_horizontal_restraint` | No support pins `Rx`. |
| `no_vertical_restraint` | No support pins `Ry`. |
| `disconnected_substructure` | Some nodes have no path to a supported node. |
| `singular_system` | Stiffness matrix is singular at solve time (mechanism). |

### CORS

`/api/v1/solve` is open to localhost dev origins plus a small production host allowlist (`https://statics.kafkadesign.io`, `https://structural-terminal.vercel.app`, `https://app-topaz-five-44.vercel.app`). Add origins in `app/api/v1/solve/route.ts`.

### Versioning

`/api/v1/` is stable. Breaking changes go to `/api/v2/`.

## Stack

- Next.js 16 (App Router) on Vercel
- Prisma + Neon Postgres (for the human-facing save/load only — the API is stateless)
- Auth.js v5 with Google OAuth (web app only)
- Direct-stiffness solver in `lib/solver.ts` (3 DOF/node, per-member `E·I`/`E·A`, Hermite shape functions, closed-form trapezoidal-load fixed-end forces and particular deflections)
- Scalar for API docs

## Local dev

```bash
npm install
vercel env pull .env.local --yes
npm run db:push
npm run dev
```

`npm run build` only generates the Prisma client and compiles Next.js. Schema
changes are deliberate database operations: use `npm run db:push` for local
prototype sync, or `npm run db:deploy` once real Prisma migrations exist.

## Solver Scenarios

Run local JSON fixtures without starting the web app:

```bash
npm run scenarios
```

Fixtures live in `scenarios/` and use the same request shape as
`/api/v1/solve`. Pass one or more fixture paths after `--` to run a subset.
