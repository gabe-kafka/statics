import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "statics — structural analysis API",
    version: "1.0.0",
    description:
      "Stateless 2D-frame direct-stiffness solver. POST a structural problem (geometry + supports + loads + section properties) and receive reactions, member end-forces, and sampled V/M/θ/Δ along each member. Optional rendered SVG diagrams in the notebook palette.",
    contact: { name: "statics", url: "https://statics.kafkadesign.io" },
  },
  servers: [
    { url: "https://statics.kafkadesign.io", description: "production" },
  ],
  paths: {
    "/api/v1/solve": {
      post: {
        summary: "Solve a 2D frame",
        description:
          "Runs direct-stiffness analysis on the supplied structural problem. Sign convention: world +y is up; downward loads are negative.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SolveRequest" },
              example: {
                nodes: [
                  [0, 0],
                  [15, 0],
                  [31, 0],
                ],
                members: [
                  { i: 0, j: 1, E: 29000, I: 100, A: 10 },
                  { i: 1, j: 2, E: 29000, I: 100, A: 10 },
                ],
                supports: [
                  { node: 0, Rx: true, Ry: true, Rm: false },
                  { node: 2, Rx: false, Ry: true, Rm: false },
                ],
                pointLoads: [{ node: 1, Fx: 0, Fy: -10, M: 0 }],
                distLoads: [
                  { member: 0, wi: -2.98, wj: -2.98 },
                  { member: 1, wi: -3.5, wj: -5.64 },
                ],
                samplesPerMember: 40,
                include: ["data"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Solver succeeded.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SolveResponse" },
              },
            },
          },
          "400": {
            description: "Malformed input — refs out of range, zero-length member, etc.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
          "422": {
            description:
              "Solver could not produce a result — instability, missing restraints, disconnected substructure, or singular system.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
      options: {
        summary: "CORS preflight",
        responses: { "204": { description: "No content." } },
      },
    },
  },
  components: {
    schemas: {
      SolveRequest: {
        type: "object",
        required: ["nodes", "members", "supports"],
        properties: {
          nodes: {
            type: "array",
            description: "Array of [x, y] pairs in world coordinates.",
            items: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
            },
            minItems: 2,
          },
          members: {
            type: "array",
            description:
              "Frame members. E, I, and A are applied per member as E·I and E·A; mixed sections are supported.",
            items: {
              type: "object",
              required: ["i", "j", "E", "I", "A"],
              properties: {
                i: { type: "integer", description: "start-node index" },
                j: { type: "integer", description: "end-node index" },
                E: { type: "number", description: "modulus of elasticity" },
                I: { type: "number", description: "moment of inertia" },
                A: { type: "number", description: "cross-sectional area" },
              },
            },
          },
          supports: {
            type: "array",
            items: {
              type: "object",
              required: ["node", "Rx", "Ry", "Rm"],
              properties: {
                node: { type: "integer" },
                Rx: { type: "boolean", description: "restrain horizontal translation" },
                Ry: { type: "boolean", description: "restrain vertical translation" },
                Rm: { type: "boolean", description: "restrain rotation" },
              },
            },
          },
          pointLoads: {
            type: "array",
            items: {
              type: "object",
              required: ["node", "Fx", "Fy"],
              properties: {
                node: { type: "integer" },
                Fx: { type: "number" },
                Fy: { type: "number", description: "global +y; downward = negative" },
                M: { type: "number", default: 0 },
              },
            },
          },
          distLoads: {
            type: "array",
            description: "Linearly-varying member-perpendicular loads (global -y projection).",
            items: {
              type: "object",
              required: ["member", "wi", "wj"],
              properties: {
                member: { type: "integer" },
                wi: { type: "number", description: "intensity at member start" },
                wj: { type: "number", description: "intensity at member end" },
              },
            },
          },
          hinges: {
            type: "array",
            description:
              "Moment releases at explicit member ends. Use member/end; node/memberSide is accepted as a compatibility alias.",
            items: {
              type: "object",
              properties: {
                member: { type: "integer" },
                end: { type: "string", enum: ["i", "j"] },
                node: { type: "integer" },
                memberSide: { type: "string", enum: ["i", "j"] },
              },
            },
          },
          samplesPerMember: {
            type: "integer",
            description: "Sample count per member for V/M/θ/Δ. Min 2, max 500.",
            default: 40,
            minimum: 2,
            maximum: 500,
          },
          include: {
            type: "array",
            description:
              "Output sections to include. `data` is always returned; add `svg` to receive pre-rendered SVG strings.",
            items: { type: "string", enum: ["data", "svg"] },
            default: ["data"],
          },
        },
      },
      SolveResponse: {
        type: "object",
        required: ["ok", "reactions", "members", "peaks"],
        properties: {
          ok: { type: "boolean", enum: [true] },
          reactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                node: { type: "integer" },
                Rx: { type: "number" },
                Ry: { type: "number" },
                M: { type: "number" },
              },
            },
          },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                i: { type: "integer" },
                j: { type: "integer" },
                L: { type: "number" },
                c: { type: "number", description: "member direction cosine" },
                s: { type: "number", description: "member direction sine" },
                endForces: {
                  type: "object",
                  properties: {
                    Ni: { type: "number" },
                    Vi: { type: "number" },
                    Mi: { type: "number" },
                    Nj: { type: "number" },
                    Vj: { type: "number" },
                    Mj: { type: "number" },
                  },
                },
                samples: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      s: { type: "number", description: "distance along member" },
                      x: { type: "number", description: "global x at this sample" },
                      y: { type: "number", description: "global y at this sample" },
                      V: { type: "number" },
                      M: { type: "number" },
                      theta: { type: "number" },
                      delta: { type: "number" },
                    },
                  },
                },
              },
            },
          },
          peaks: {
            type: "object",
            properties: {
              V: { $ref: "#/components/schemas/Peak" },
              M: { $ref: "#/components/schemas/Peak" },
              theta: { $ref: "#/components/schemas/Peak" },
              delta: { $ref: "#/components/schemas/Peak" },
            },
          },
          svg: {
            type: "object",
            description: "Present only when `include` contains `svg`.",
            properties: {
              fbd: { type: "string" },
              V: { type: "string" },
              M: { type: "string" },
              theta: { type: "string" },
              delta: { type: "string" },
              all: { type: "string", description: "Full stacked panel." },
            },
          },
          warnings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {},
              },
            },
          },
        },
      },
      Peak: {
        type: "object",
        properties: {
          value: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          member: { type: "integer" },
          sLocal: { type: "number" },
        },
      },
      ApiError: {
        type: "object",
        required: ["ok", "error", "message"],
        properties: {
          ok: { type: "boolean", enum: [false] },
          error: {
            type: "string",
            enum: [
              "invalid_input",
              "degenerate_member",
              "non_positive_section",
              "insufficient_supports",
              "no_horizontal_restraint",
              "no_vertical_restraint",
              "disconnected_substructure",
              "singular_system",
            ],
            description: "Stable machine-readable code; switch on this in clients.",
          },
          message: { type: "string", description: "Human-readable explanation." },
          details: {
            description:
              "Failure-specific structured data — implicated node/member, missing restraint, etc.",
          },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(SPEC);
}
