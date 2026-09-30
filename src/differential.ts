import { Ledger } from "./core/ledger";
import { Marketplace } from "./core/marketplace";
import { NftRegistry } from "./core/nftRegistry";
import { ModelError } from "./core/errors";

/**
 * Differential testing support.
 *
 * Random operation sequences are run through the TypeScript model. For every step we record
 * whether it succeeded, and at the end we record a full state vector. The Solidity test
 * (solidity/test/Differential.t.sol) replays the same steps against the contracts and must
 * agree on every success/failure and on the final state.
 *
 * Everything is encoded as small integers so both languages can read the same JSON file.
 */

/** Actor names, by index. 7 (NONE) means "nobody" / address(0). */
export const NAMES = ["admin", "alice", "bob", "carol", "market", "treasury", "artist"] as const;
export const NONE = 7;
export const MAX_ID = 4;

export const OPS = [
  "ftMint", //          caller, to, amount
  "ftBurn", //          caller, amount
  "ftTransfer", //      caller, to, amount
  "ftApprove", //       caller, spender, amount
  "ftTransferFrom", //  caller, from, to, amount
  "nftMint", //         caller, to, id, royaltyReceiver (7 = none), royaltyBps
  "nftBurn", //         caller, id
  "nftTransfer", //     caller, from, to, id
  "nftApprove", //      caller, spender (7 = clear), id
  "nftApproveAll", //   caller, operator, approved (0/1)
  "mktList", //         caller, id, price
  "mktCancel", //       caller, id
  "mktBuy", //          caller, id
] as const;

/** [op, caller, a, b, c, d]. Callers are always 0..3; other fields depend on the op. */
export type Step = [number, number, number, number, number, number];
export const ROW = 7; // six step fields + the expected "succeeded" flag

export interface Universe {
  ft: Ledger;
  nft: NftRegistry;
  market: Marketplace;
}

export function newUniverse(): Universe {
  const ft = new Ledger("Gold", "GLD", ["admin"]);
  const nft = new NftRegistry("Art", "ART", ["admin"]);
  const market = new Marketplace("market", ft, nft, "treasury", 250);
  return { ft, nft, market };
}

const name = (i: number) => NAMES[i]!;

/** Apply one step; throws ModelError if the model rejects it. */
export function applyStep(u: Universe, s: Step): void {
  const [op, c, a, b, cc, d] = s;
  const caller = name(c);
  switch (OPS[op]) {
    case "ftMint":
      return u.ft.mint(caller, name(a), BigInt(b));
    case "ftBurn":
      return u.ft.burn(caller, BigInt(a));
    case "ftTransfer":
      return u.ft.transfer(caller, name(a), BigInt(b));
    case "ftApprove":
      return u.ft.approve(caller, name(a), BigInt(b));
    case "ftTransferFrom":
      return u.ft.transferFrom(caller, name(a), name(b), BigInt(cc));
    case "nftMint":
      return u.nft.mint(caller, name(a), String(b), "", cc === NONE ? undefined : { receiver: name(cc), bps: d });
    case "nftBurn":
      return u.nft.burn(caller, String(a));
    case "nftTransfer":
      return u.nft.transferFrom(caller, name(a), name(b), String(cc));
    case "nftApprove":
      return u.nft.approve(caller, a === NONE ? null : name(a), String(b));
    case "nftApproveAll":
      return u.nft.setApprovalForAll(caller, name(a), b === 1);
    case "mktList":
      return u.market.list(caller, String(a), BigInt(b));
    case "mktCancel":
      return u.market.cancel(caller, String(a));
    case "mktBuy":
      return void u.market.buy(caller, String(a));
    default:
      throw new Error(`unknown op ${op}`);
  }
}

/** Run a step and report whether it succeeded. Only ModelErrors count as "rejected". */
export function tryStep(u: Universe, s: Step): boolean {
  try {
    applyStep(u, s);
    return true;
  } catch (e) {
    if (e instanceof ModelError) return false;
    throw e;
  }
}

function marketApprovedId(u: Universe, id: number): boolean {
  const key = String(id);
  return u.nft.getApproved(key) === "market" || u.nft.isApprovedForAll(u.nft.ownerOf(key), "market");
}

const idx = (who: string | null | undefined) => {
  const i = who ? NAMES.indexOf(who as (typeof NAMES)[number]) : -1;
  return i < 0 ? NONE : i;
};

/**
 * Flatten the whole observable state into integers. The Solidity test builds the same vector
 * in the same order, so the layout here is a contract between the two sides:
 *   ft balances[7], nft balances[7], ft supply, nft supply,
 *   per id 1..4: exists, owner, approved, royaltyReceiver, royaltyBps, listingSeller, listingPrice,
 *   ft allowance[owner 7][spender 7], nft operator approval[owner 7][operator 7]
 */
export function stateVector(u: Universe): number[] {
  const v: number[] = [];
  for (const n of NAMES) v.push(Number(u.ft.balanceOf(n)));
  for (const n of NAMES) v.push(u.nft.balanceOf(n));
  v.push(Number(u.ft.totalSupply()), u.nft.totalSupply());
  for (let id = 1; id <= MAX_ID; id++) {
    const key = String(id);
    const exists = u.nft.exists(key);
    const roy = exists ? u.nft.royaltyInfo(key) : null;
    const listing = u.market.getListing(key);
    v.push(
      exists ? 1 : 0,
      exists ? idx(u.nft.ownerOf(key)) : NONE,
      exists ? idx(u.nft.getApproved(key)) : NONE,
      idx(roy?.receiver),
      roy?.bps ?? 0,
      idx(listing?.seller),
      listing ? Number(listing.price) : 0,
    );
  }
  for (const o of NAMES) for (const s of NAMES) v.push(Number(u.ft.allowance(o, s)));
  for (const o of NAMES) for (const s of NAMES) v.push(u.nft.isApprovedForAll(o, s) ? 1 : 0);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Scenario generation

/** Small, fast, seedable PRNG so the committed fixture is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenario {
  rows: number[]; // flattened, ROW numbers per step: the 6 step fields + expected-success flag
  final: number[];
}

export interface Generated {
  scenarios: Scenario[];
  /** successes[op] = how many steps of that op succeeded, for coverage checks. */
  successes: number[];
  attempts: number[];
}

/**
 * Steps are chosen with a bias towards useful moves (act as the real owner, approve the
 * marketplace, buy what is listed) so that long successful chains happen, while still
 * producing plenty of invalid moves.
 */
export function generate(seed: number, scenarios: number, steps: number): Generated {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const chance = (p: number) => rnd() < p;
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  const out: Generated = {
    scenarios: [],
    successes: OPS.map(() => 0),
    attempts: OPS.map(() => 0),
  };
  const weights: [number, number][] = [
    [0, 10], [1, 3], [2, 8], [3, 10], [4, 6], [5, 10], [6, 3],
    [7, 8], [8, 10], [9, 5], [10, 10], [11, 3], [12, 12],
  ];
  const ops = weights.flatMap(([op, w]) => Array<number>(w).fill(op));

  for (let n = 0; n < scenarios; n++) {
    const u = newUniverse();
    const rows: number[] = [];
    for (let k = 0; k < steps; k++) {
      const liveIds = [1, 2, 3, 4].filter((i) => u.nft.exists(String(i)));
      const listed = liveIds.filter((i) => u.market.getListing(String(i)));
      // Random choice, nudged along the "sale pipeline" so long successful chains do occur:
      // mint -> approve market -> list -> (fund + approve FT) -> buy.
      let op = pick(ops);
      const unapproved = liveIds.filter((i) => !u.market.getListing(String(i)) && !marketApprovedId(u, i));
      const readyToList = liveIds.filter((i) => !u.market.getListing(String(i)) && marketApprovedId(u, i));
      const hasBuyer = listed.some((id) => {
        const price = u.market.getListing(String(id))!.price;
        return [1, 2, 3].some((b) => u.ft.balanceOf(name(b)) >= price && u.ft.allowance(name(b), "market") >= price);
      });
      if (listed.length && hasBuyer && chance(0.5)) op = OPS.indexOf("mktBuy");
      else if (listed.length && !hasBuyer && chance(0.4)) op = OPS.indexOf(chance(0.5) ? "ftMint" : "ftApprove");
      else if (listed.length && chance(0.05)) op = OPS.indexOf("mktBuy");
      else if (readyToList.length && chance(0.3)) op = OPS.indexOf("mktList");
      else if (unapproved.length && chance(0.2)) op = OPS.indexOf("nftApprove");
      else if (!liveIds.length && chance(0.5)) op = OPS.indexOf("nftMint");
      const anyId = () => int(1, MAX_ID);
      const marketApproved = (id: string) =>
        u.nft.getApproved(id) === "market" || u.nft.isApprovedForAll(u.nft.ownerOf(id), "market");
      const ownerOf = (id: number) => (u.nft.exists(String(id)) ? idx(u.nft.ownerOf(String(id))) : int(0, 3));
      const someone = () => int(0, 3);
      const target = () => int(0, 6);
      const actAsOwner = (id: number, p: number) => (chance(p) ? Math.min(ownerOf(id), 3) : someone());
      let s: Step;

      switch (OPS[op]) {
        case "ftMint":
          s = [op, chance(0.85) ? 0 : someone(), chance(0.7) ? int(1, 3) : target(), chance(0.05) ? 0 : int(100, 1500), 0, 0];
          break;
        case "ftBurn": {
          const c = someone();
          const bal = Number(u.ft.balanceOf(name(c)));
          s = [op, c, chance(0.75) ? int(0, bal) : int(0, 600), 0, 0, 0];
          break;
        }
        case "ftTransfer": {
          const c = someone();
          const bal = Number(u.ft.balanceOf(name(c)));
          s = [op, c, target(), chance(0.75) ? int(0, bal) : int(0, 600), 0, 0];
          break;
        }
        case "ftApprove":
          s = [op, someone(), chance(0.55) ? 4 : target(), chance(0.3) ? int(0, 50) : int(0, 2000), 0, 0];
          break;
        case "ftTransferFrom": {
          // Prefer a real (owner, spender) allowance so that the spend can actually succeed.
          const pairs: [number, number][] = [];
          for (let o = 0; o <= 3; o++)
            for (let sp = 0; sp <= 3; sp++)
              if (u.ft.allowance(name(o), name(sp)) > 0n && u.ft.balanceOf(name(o)) > 0n) pairs.push([o, sp]);
          if (pairs.length && chance(0.8)) {
            const [o, sp] = pick(pairs);
            const cap = Number(u.ft.allowance(name(o), name(sp)) < u.ft.balanceOf(name(o)) ? u.ft.allowance(name(o), name(sp)) : u.ft.balanceOf(name(o)));
            s = [op, sp, o, target(), chance(0.85) ? int(0, cap) : int(0, cap + 50), 0];
          } else {
            s = [op, someone(), someone(), target(), int(0, 300), 0];
          }
          break;
        }
        case "nftMint": {
          const none = chance(0.4);
          s = [op, chance(0.85) ? 0 : someone(), int(1, 3), anyId(), none ? NONE : int(1, 6), none ? 0 : chance(0.85) ? int(0, 1000) : int(1001, 1100)];
          break;
        }
        case "nftBurn": {
          const id = anyId();
          s = [op, actAsOwner(id, 0.7), id, 0, 0, 0];
          break;
        }
        case "nftTransfer": {
          const id = anyId();
          s = [op, actAsOwner(id, 0.6), chance(0.85) ? ownerOf(id) : target(), target(), id, 0];
          break;
        }
        case "nftApprove": {
          const id = anyId();
          const r = rnd();
          s = [op, actAsOwner(id, 0.75), r < 0.5 ? 4 : r < 0.65 ? NONE : target(), id, 0, 0];
          break;
        }
        case "nftApproveAll":
          s = [op, int(1, 3), chance(0.5) ? 4 : target(), chance(0.75) ? 1 : 0, 0, 0];
          break;
        case "mktList": {
          // Prefer tokens whose owner has already approved the marketplace.
          const ready = liveIds.filter((i) => marketApproved(String(i)));
          const id = ready.length && chance(0.8) ? pick(ready) : liveIds.length && chance(0.7) ? pick(liveIds) : anyId();
          s = [op, actAsOwner(id, 0.85), id, chance(0.03) ? 0 : int(1, 800), 0, 0];
          break;
        }
        case "mktCancel": {
          const id = listed.length && chance(0.8) ? pick(listed) : anyId();
          const seller = u.market.getListing(String(id))?.seller;
          s = [op, seller && chance(0.75) ? Math.min(idx(seller), 3) : someone(), id, 0, 0, 0];
          break;
        }
        case "mktBuy": {
          // Prefer a listed token and a buyer who has both the funds and the allowance for it.
          const options: [number, number][] = [];
          for (const id of listed) {
            const l = u.market.getListing(String(id))!;
            for (let b = 1; b <= 3; b++) {
              if (u.ft.balanceOf(name(b)) >= l.price && u.ft.allowance(name(b), "market") >= l.price) options.push([id, b]);
            }
          }
          if (options.length && chance(0.75)) {
            const [id, b] = pick(options);
            s = [op, b, id, 0, 0, 0];
          } else {
            const id = listed.length && chance(0.8) ? pick(listed) : anyId();
            s = [op, int(1, 3), id, 0, 0, 0];
          }
          break;
        }
        default:
          throw new Error("unreachable");
      }

      const ok = tryStep(u, s);
      out.attempts[op]!++;
      if (ok) out.successes[op]!++;
      rows.push(...s, ok ? 1 : 0);
    }
    out.scenarios.push({ rows, final: stateVector(u) });
  }
  return out;
}

/** The exact JSON the Solidity test reads. */
export function toFixture(g: Generated): string {
  const o: Record<string, unknown> = { count: g.scenarios.length, row: ROW };
  g.scenarios.forEach((s, i) => {
    o[`s${i}`] = s.rows;
    o[`e${i}`] = s.final;
  });
  return JSON.stringify(o);
}

export const FIXTURE_SEED = 20261001;
export const FIXTURE_SCENARIOS = 120;
export const FIXTURE_STEPS = 80;
