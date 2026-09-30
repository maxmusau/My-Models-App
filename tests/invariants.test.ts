import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Ledger, NftRegistry, ModelError } from "../src";

const users = ["alice", "bob", "carol", "admin", "mallory"];
const user = fc.constantFrom(...users);
const amount = fc.bigInt({ min: -2n, max: 200n });
const tokenId = fc.constantFrom("1", "2", "3", "4");

function ledgerSnapshot(l: Ledger) {
  const bal = [...l.holders()].sort();
  const allow = users.flatMap((o) => users.map((s) => [o, s, l.allowance(o, s)]));
  return { supply: l.totalSupply(), bal, allow };
}

function nftSnapshot(r: NftRegistry) {
  return {
    tokens: r.allTokens().map((id) => [id, r.ownerOf(id), r.getApproved(id)]),
    ops: users.flatMap((o) => users.map((p) => [o, p, r.isApprovedForAll(o, p)])),
  };
}

describe("FT invariants under random operation sequences", () => {
  type Op =
    | ["mint", string, string, bigint]
    | ["burn", string, bigint]
    | ["transfer", string, string, bigint]
    | ["approve", string, string, bigint]
    | ["transferFrom", string, string, string, bigint];

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.tuple(fc.constant("mint" as const), user, user, amount),
    fc.tuple(fc.constant("burn" as const), user, amount),
    fc.tuple(fc.constant("transfer" as const), user, user, amount),
    fc.tuple(fc.constant("approve" as const), user, user, amount),
    fc.tuple(fc.constant("transferFrom" as const), user, user, user, amount),
  );

  it("supply equals sum of balances, balances never negative, failed ops change nothing", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const l = new Ledger("T", "T", ["admin"]);
        let minted = 0n;
        let burned = 0n;
        for (const o of ops) {
          const before = ledgerSnapshot(l);
          let ok = true;
          try {
            if (o[0] === "mint") l.mint(o[1], o[2], o[3]);
            else if (o[0] === "burn") l.burn(o[1], o[2]);
            else if (o[0] === "transfer") l.transfer(o[1], o[2], o[3]);
            else if (o[0] === "approve") l.approve(o[1], o[2], o[3]);
            else l.transferFrom(o[1], o[2], o[3], o[4]);
          } catch (e) {
            if (!(e instanceof ModelError)) throw e; // only domain errors are acceptable
            ok = false;
          }
          if (!ok) expect(ledgerSnapshot(l)).toEqual(before);
          else if (o[0] === "mint") minted += o[3];
          else if (o[0] === "burn") burned += o[2];

          let sum = 0n;
          for (const [, b] of l.holders()) {
            expect(b > 0n).toBe(true); // zero balances are pruned, none negative
            sum += b;
          }
          expect(l.totalSupply()).toBe(sum);
          expect(l.totalSupply()).toBe(minted - burned);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("NFT invariants under random operation sequences", () => {
  type Op =
    | ["mint", string, string, string]
    | ["burn", string, string]
    | ["transferFrom", string, string, string, string]
    | ["approve", string, string | null, string]
    | ["setApprovalForAll", string, string, boolean];

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.tuple(fc.constant("mint" as const), user, user, tokenId),
    fc.tuple(fc.constant("burn" as const), user, tokenId),
    fc.tuple(fc.constant("transferFrom" as const), user, user, user, tokenId),
    fc.tuple(fc.constant("approve" as const), user, fc.option(user, { nil: null }), tokenId),
    fc.tuple(fc.constant("setApprovalForAll" as const), user, user, fc.boolean()),
  );

  it("one owner per token, balances sum to supply, failed ops change nothing", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const r = new NftRegistry("N", "N", ["admin"]);
        for (const o of ops) {
          const before = nftSnapshot(r);
          let ok = true;
          try {
            if (o[0] === "mint") r.mint(o[1], o[2], o[3]);
            else if (o[0] === "burn") r.burn(o[1], o[2]);
            else if (o[0] === "transferFrom") r.transferFrom(o[1], o[2], o[3], o[4]);
            else if (o[0] === "approve") r.approve(o[1], o[2], o[3]);
            else r.setApprovalForAll(o[1], o[2], o[3]);
          } catch (e) {
            if (!(e instanceof ModelError)) throw e;
            ok = false;
          }
          if (!ok) expect(nftSnapshot(r)).toEqual(before);

          const ids = r.allTokens();
          expect(new Set(ids).size).toBe(ids.length);
          expect(r.totalSupply()).toBe(ids.length);
          expect(users.reduce((n, u) => n + r.balanceOf(u), 0)).toBe(ids.length);
          for (const id of ids) {
            expect(users).toContain(r.ownerOf(id));
            expect(r.getApproved(id)).not.toBe(r.ownerOf(id));
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a successful transfer always clears the token approval and moves ownership", () => {
    fc.assert(
      fc.property(user, user, user, (owner, spender, to) => {
        fc.pre(owner !== spender);
        const r = new NftRegistry("N", "N", ["admin"]);
        r.mint("admin", owner, "1");
        r.approve(owner, spender, "1");
        r.transferFrom(spender, owner, to, "1");
        expect(r.ownerOf("1")).toBe(to);
        expect(r.getApproved("1")).toBeNull();
      }),
    );
  });
});
