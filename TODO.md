# Statics TODO

These are the steps we will address, one at a time.

1. [x] Add solver tests for canonical structural-analysis cases.
2. [x] Make correctness visible in the UI with equilibrium checks and peak result summaries.
3. [ ] Fix the current lint failures so the quality gate is green.
4. [ ] Split notebook parsing, design state, persistence UI, and table editing into smaller modules.
5. [ ] Remove hidden API assumptions around per-member `E`, `I`, and `A`.
6. [ ] Add a small example gallery with known inputs, diagrams, and API payloads.
7. [ ] Move database schema mutation out of the production build script.
8. [ ] Add a local solver scenario runner for JSON fixtures and equilibrium summaries.
9. [ ] Get moment frames working end to end, including non-horizontal members in API output, diagrams, and UI assumptions.
10. [ ] Get hinges working with explicit member-end releases and matching tests.
11. [ ] Implement all reasonable added functionality in `structural-terminal`, the core consumer of this API.
