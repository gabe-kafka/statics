import type { ApiError, SolveRequest } from "./types";

// Returns the first failure as a structured ApiError, or null if input is
// well-formed and stable enough for the solver to attempt.
export function validate(req: SolveRequest): ApiError | null {
  // ── Shape checks ──────────────────────────────────────────────
  if (!req || typeof req !== "object")
    return err("invalid_input", "Request body must be a JSON object.");
  if (!Array.isArray(req.nodes))
    return err("invalid_input", "`nodes` must be an array of [x, y] pairs.");
  if (!Array.isArray(req.members))
    return err("invalid_input", "`members` must be an array.");
  if (!Array.isArray(req.supports))
    return err("invalid_input", "`supports` must be an array.");

  // ── Node sanity ───────────────────────────────────────────────
  for (let n = 0; n < req.nodes.length; n++) {
    const p = req.nodes[n];
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteNum(p[0]) || !isFiniteNum(p[1]))
      return err(
        "invalid_input",
        `Node ${n} must be [x, y] with finite numbers.`,
        { field: `nodes[${n}]`, value: p },
      );
  }
  if (req.nodes.length < 2)
    return err("invalid_input", "Need at least 2 nodes.", {
      nodeCount: req.nodes.length,
    });

  // ── Member sanity ─────────────────────────────────────────────
  for (let m = 0; m < req.members.length; m++) {
    const mem = req.members[m];
    if (!mem || typeof mem !== "object")
      return err("invalid_input", `Member ${m} must be an object.`);
    const ref = (idx: number, field: string) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= req.nodes.length)
        return err(
          "invalid_input",
          `Member ${m} references node ${idx} (only ${req.nodes.length} nodes provided).`,
          { field: `members[${m}].${field}`, value: idx, limit: req.nodes.length - 1 },
        );
      return null;
    };
    const e1 = ref(mem.i, "i");
    if (e1) return e1;
    const e2 = ref(mem.j, "j");
    if (e2) return e2;
    if (mem.i === mem.j)
      return err("degenerate_member", `Member ${m} starts and ends at the same node ${mem.i}.`, {
        member: m,
        i: mem.i,
        j: mem.j,
      });
    const a = req.nodes[mem.i];
    const b = req.nodes[mem.j];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9)
      return err(
        "degenerate_member",
        `Member ${m} has zero length (nodes ${mem.i} and ${mem.j} are coincident).`,
        { member: m, i: mem.i, j: mem.j, length: L },
      );
    if (!(mem.E > 0) || !(mem.I > 0) || !(mem.A > 0))
      return err(
        "non_positive_section",
        `Member ${m} has non-positive section properties (E=${mem.E}, I=${mem.I}, A=${mem.A}).`,
        { member: m, E: mem.E, I: mem.I, A: mem.A },
      );
  }

  // ── Support sanity ────────────────────────────────────────────
  for (let s = 0; s < req.supports.length; s++) {
    const sup = req.supports[s];
    if (!sup || !Number.isInteger(sup.node) || sup.node < 0 || sup.node >= req.nodes.length)
      return err(
        "invalid_input",
        `Support ${s} references invalid node ${sup?.node}.`,
        { field: `supports[${s}].node`, value: sup?.node },
      );
  }

  // ── Load reference checks ─────────────────────────────────────
  for (let p = 0; p < (req.pointLoads ?? []).length; p++) {
    const pl = req.pointLoads![p];
    if (!Number.isInteger(pl.node) || pl.node < 0 || pl.node >= req.nodes.length)
      return err("invalid_input", `pointLoads[${p}] references invalid node ${pl.node}.`, {
        field: `pointLoads[${p}].node`,
        value: pl.node,
      });
    if (!isFiniteNum(pl.Fx) || !isFiniteNum(pl.Fy) || (pl.M !== undefined && !isFiniteNum(pl.M)))
      return err("invalid_input", `pointLoads[${p}] must have finite Fx, Fy, and optional M.`, {
        field: `pointLoads[${p}]`,
        value: pl,
      });
  }
  for (let d = 0; d < (req.distLoads ?? []).length; d++) {
    const dl = req.distLoads![d];
    if (!Number.isInteger(dl.member) || dl.member < 0 || dl.member >= req.members.length)
      return err(
        "invalid_input",
        `distLoads[${d}] references invalid member ${dl.member}.`,
        { field: `distLoads[${d}].member`, value: dl.member },
      );
    if (!isFiniteNum(dl.wi) || !isFiniteNum(dl.wj))
      return err("invalid_input", `distLoads[${d}] must have finite wi and wj.`, {
        field: `distLoads[${d}]`,
        value: dl,
      });
  }

  for (let s = 0; s < (req.pointSprings ?? []).length; s++) {
    const spring = req.pointSprings![s];
    if (!Number.isInteger(spring.node) || spring.node < 0 || spring.node >= req.nodes.length)
      return err(
        "invalid_input",
        `pointSprings[${s}] references invalid node ${spring.node}.`,
        { field: `pointSprings[${s}].node`, value: spring.node },
      );
    if (
      !isNonnegativeFinite(spring.Kx) ||
      !isNonnegativeFinite(spring.Ky) ||
      !isNonnegativeFinite(spring.Km)
    )
      return err(
        "invalid_input",
        `pointSprings[${s}] must have finite non-negative Kx, Ky, and Km.`,
        { field: `pointSprings[${s}]`, value: spring },
      );
  }

  for (let s = 0; s < (req.uniformSprings ?? []).length; s++) {
    const spring = req.uniformSprings![s];
    if (!Number.isInteger(spring.member) || spring.member < 0 || spring.member >= req.members.length)
      return err(
        "invalid_input",
        `uniformSprings[${s}] references invalid member ${spring.member}.`,
        { field: `uniformSprings[${s}].member`, value: spring.member },
      );
    if (!isNonnegativeFinite(spring.k))
      return err(
        "invalid_input",
        `uniformSprings[${s}] must have finite non-negative k (force/deflection/length).`,
        { field: `uniformSprings[${s}].k`, value: spring.k },
      );
  }

  for (let h = 0; h < (req.hinges ?? []).length; h++) {
    const hinge = req.hinges![h];
    const end = hinge.end ?? hinge.memberSide;
    if (end !== "i" && end !== "j")
      return err("invalid_input", `hinges[${h}] must specify end "i" or "j".`, {
        field: `hinges[${h}].end`,
        value: hinge,
      });
    if (hinge.member !== undefined) {
      if (!Number.isInteger(hinge.member) || hinge.member < 0 || hinge.member >= req.members.length)
        return err("invalid_input", `hinges[${h}] references invalid member ${hinge.member}.`, {
          field: `hinges[${h}].member`,
          value: hinge.member,
        });
      continue;
    }
    if (hinge.node === undefined || !Number.isInteger(hinge.node) || hinge.node < 0 || hinge.node >= req.nodes.length)
      return err("invalid_input", `hinges[${h}] must reference a valid member or node.`, {
        field: `hinges[${h}]`,
        value: hinge,
      });
    const matches = req.members.filter((member) => member[end] === hinge.node);
    if (matches.length === 0)
      return err("invalid_input", `hinges[${h}] did not match a member ${end}-end at node ${hinge.node}.`, {
        field: `hinges[${h}]`,
        value: hinge,
      });
  }

  // ── Stability: count restrained DOFs ──────────────────────────
  let nRx = 0,
    nRy = 0,
    nRm = 0;
  for (const sup of req.supports) {
    if (sup.Rx) nRx++;
    if (sup.Ry) nRy++;
    if (sup.Rm) nRm++;
  }
  for (const spring of req.pointSprings ?? []) {
    if (spring.Kx > 0) nRx++;
    if (spring.Ky > 0) nRy++;
    if (spring.Km > 0) nRm++;
  }
  for (const spring of req.uniformSprings ?? []) {
    if (spring.k <= 0) continue;
    const member = req.members[spring.member];
    const a = req.nodes[member.i];
    const b = req.nodes[member.j];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const localYx = -(b[1] - a[1]) / L;
    const localYy = (b[0] - a[0]) / L;
    if (Math.abs(localYx) > 1e-9) nRx++;
    if (Math.abs(localYy) > 1e-9) nRy++;
    nRm++;
  }
  const total = nRx + nRy + nRm;
  if (total < 3)
    return err(
      "insufficient_supports",
      `Structure has only ${total} restrained DOFs; 2D analysis needs at least 3.`,
      {
        restrainedDOFs: total,
        minimum: 3,
        supports: req.supports,
        pointSprings: req.pointSprings ?? [],
        uniformSprings: req.uniformSprings ?? [],
      },
    );
  if (nRx === 0)
    return err(
      "no_horizontal_restraint",
      "No support restrains horizontal translation — structure floats in x.",
      { missing: "Rx" },
    );
  if (nRy === 0)
    return err(
      "no_vertical_restraint",
      "No support restrains vertical translation — structure floats in y.",
      { missing: "Ry" },
    );

  // ── Stability: connected component check ─────────────────────
  // BFS from supported nodes; any unreached node is in a floating component.
  const adj: Set<number>[] = req.nodes.map(() => new Set<number>());
  for (const m of req.members) {
    adj[m.i].add(m.j);
    adj[m.j].add(m.i);
  }
  const supported = new Set(req.supports.map((s) => s.node));
  for (const spring of req.pointSprings ?? []) {
    if (spring.Kx > 0 || spring.Ky > 0 || spring.Km > 0) supported.add(spring.node);
  }
  for (const spring of req.uniformSprings ?? []) {
    if (spring.k <= 0) continue;
    const member = req.members[spring.member];
    supported.add(member.i);
    supported.add(member.j);
  }
  const visited = new Set<number>();
  const queue = [...supported];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (visited.has(n)) continue;
    visited.add(n);
    for (const nb of adj[n]) if (!visited.has(nb)) queue.push(nb);
  }
  const floating: number[] = [];
  for (let n = 0; n < req.nodes.length; n++) {
    if (!visited.has(n)) floating.push(n);
  }
  if (floating.length > 0)
    return err(
      "disconnected_substructure",
      `Nodes [${floating.join(", ")}] are not connected to any support.`,
      { floatingNodes: floating, supportedNodes: [...visited].sort((a, b) => a - b) },
    );

  return null;
}

function err(code: ApiError["error"], message: string, details?: unknown): ApiError {
  return { ok: false, error: code, message, details };
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isNonnegativeFinite(x: unknown): x is number {
  return isFiniteNum(x) && x >= 0;
}
