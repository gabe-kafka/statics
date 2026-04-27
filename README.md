# statics

A 2D-frame structural-analysis tool. Two surfaces:

- **Web app** at <https://statics.kafkadesign.io> — interactive editor for nodes, members, supports, loads, and material properties; renders FBD, V(x), M(x), θ(x), Δ(x) live in the conjugate-method notebook palette.
- **HTTP API** at `/api/v1/solve` — stateless direct-stiffness solver. POST a structural problem, receive reactions, member end-forces, and sampled V/M/θ/Δ along each member. Optional pre-rendered SVG diagrams.

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
    "pointLoads": [{"node":1,"Fx":0,"Fy":-10}],
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
    { "i": 0, "j": 1, "L": 15, "endForces": {...}, "samples": [...] }
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

### Sign convention

World `+y` is up. Loads given in `+y`; downward loads are negative. Units pass through (kip / in / ksi works; the solver doesn't enforce them).

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

`/api/v1/solve` is open to a small allowlist (`http://localhost:5173`, `http://localhost:3000`, `https://statics.kafkadesign.io`). Add origins in `app/api/v1/solve/route.ts`.

### Versioning

`/api/v1/` is stable. Breaking changes go to `/api/v2/`.

## Stack

- Next.js 16 (App Router) on Vercel
- Prisma + Neon Postgres (for the human-facing save/load only — the API is stateless)
- Auth.js v5 with Google OAuth (web app only)
- Direct-stiffness solver in `lib/solver.ts` (3 DOF/node, Hermite shape functions, closed-form trapezoidal-load fixed-end forces and particular deflections)
- Scalar for API docs

## Local dev

```bash
npm install
vercel env pull .env.local --yes
npm run dev
```
