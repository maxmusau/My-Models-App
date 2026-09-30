import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_SCENARIOS,
  FIXTURE_SEED,
  FIXTURE_STEPS,
  OPS,
  generate,
  toFixture,
} from "../src/differential";

const out = fileURLToPath(new URL("../solidity/test/fixtures/scenarios.json", import.meta.url));
const g = generate(FIXTURE_SEED, FIXTURE_SCENARIOS, FIXTURE_STEPS);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toFixture(g));

console.log(`wrote ${g.scenarios.length} scenarios x ${FIXTURE_STEPS} steps -> ${out}`);
console.log("op               succeeded / attempted");
OPS.forEach((o, i) => console.log(`${o.padEnd(16)} ${String(g.successes[i]).padStart(5)} / ${g.attempts[i]}`));
