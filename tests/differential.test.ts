import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIXTURE_SCENARIOS,
  FIXTURE_SEED,
  FIXTURE_STEPS,
  OPS,
  ROW,
  Step,
  generate,
  newUniverse,
  stateVector,
  toFixture,
  tryStep,
} from "../src/differential";

const FIXTURE = new URL("../solidity/test/fixtures/scenarios.json", import.meta.url);

describe("differential fixture (shared with the Solidity tests)", () => {
  const g = generate(FIXTURE_SEED, FIXTURE_SCENARIOS, FIXTURE_STEPS);

  it("is up to date with the model — run `npm run diff:gen` if this fails", () => {
    expect(readFileSync(FIXTURE, "utf8")).toBe(toFixture(g));
  });

  it("replays to exactly the recorded outcomes and final states", () => {
    const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number[]>;
    expect(fx["count"]).toBe(FIXTURE_SCENARIOS);
    for (let i = 0; i < FIXTURE_SCENARIOS; i++) {
      const rows = fx[`s${i}`]!;
      const u = newUniverse();
      for (let k = 0; k < rows.length; k += ROW) {
        const step = rows.slice(k, k + 6) as Step;
        expect(tryStep(u, step) ? 1 : 0).toBe(rows[k + 6]);
      }
      expect(stateVector(u)).toEqual(fx[`e${i}`]);
    }
  });

  it("actually exercises every operation, both succeeding and failing", () => {
    OPS.forEach((op, i) => {
      expect(g.successes[i], `${op} never succeeds`).toBeGreaterThan(20);
      // Approving a valid spender can't fail in either implementation, so it has no failure path.
      if (op === "ftApprove") return;
      expect(g.attempts[i]! - g.successes[i]!, `${op} never fails`).toBeGreaterThan(0);
    });
  });

  it("reaches the deep marketplace paths (buys and cancels that really happen)", () => {
    expect(g.successes[OPS.indexOf("mktBuy")]).toBeGreaterThan(100);
    expect(g.successes[OPS.indexOf("mktList")]).toBeGreaterThan(200);
    expect(g.successes[OPS.indexOf("mktCancel")]).toBeGreaterThan(20);
  });

  it("is deterministic for a given seed", () => {
    expect(toFixture(generate(7, 5, 30))).toBe(toFixture(generate(7, 5, 30)));
    expect(toFixture(generate(7, 5, 30))).not.toBe(toFixture(generate(8, 5, 30)));
  });
});
