import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { Ledger, NftRegistry, Marketplace, ModelError } from "../src";

const fails = (fn: () => void, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    expect((e as ModelError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
};

function setup(feeBps = 250) {
  const ft = new Ledger("Gold", "GLD", ["admin"]);
  const nft = new NftRegistry("Art", "ART", ["admin"]);
  const market = new Marketplace("market", ft, nft, "treasury", feeBps);
  return { ft, nft, market };
}

describe("Marketplace", () => {
  let ft: Ledger, nft: NftRegistry, market: Marketplace;
  beforeEach(() => {
    ({ ft, nft, market } = setup());
    // token 1: created by artist (5% royalty), now owned by alice
    nft.mint("admin", "alice", "1", "ipfs://1", { receiver: "artist", bps: 500 });
    ft.mint("admin", "bob", 10_000n);
    ft.approve("bob", "market", 10_000n);
  });

  it("splits a sale into fee, royalty and seller proceeds", () => {
    nft.approve("alice", "market", "1");
    market.list("alice", "1", 1000n);
    const p = market.buy("bob", "1");
    expect(p).toEqual({ fee: 25n, royalty: 50n, seller: 925n });
    expect(nft.ownerOf("1")).toBe("bob");
    expect(ft.balanceOf("treasury")).toBe(25n);
    expect(ft.balanceOf("artist")).toBe(50n);
    expect(ft.balanceOf("alice")).toBe(925n);
    expect(ft.balanceOf("bob")).toBe(9000n);
    expect(ft.allowance("bob", "market")).toBe(9000n); // exactly the price was spent
    expect(market.getListing("1")).toBeNull();
  });

  it("works with operator approval and tokens without royalty", () => {
    nft.mint("admin", "alice", "2");
    nft.setApprovalForAll("alice", "market", true);
    market.list("alice", "2", 1000n);
    expect(market.buy("bob", "2")).toEqual({ fee: 25n, royalty: 0n, seller: 975n });
  });

  it("requires ownership, approval, a positive price and no duplicate listing", () => {
    fails(() => market.list("bob", "1", 100n), "NotOwner");
    fails(() => market.list("alice", "1", 100n), "MarketNotApproved");
    nft.approve("alice", "market", "1");
    fails(() => market.list("alice", "1", 0n), "InvalidPrice");
    market.list("alice", "1", 100n);
    fails(() => market.list("alice", "1", 100n), "AlreadyListed");
  });

  it("rejects buying without allowance, when broke, unlisted, or your own token", () => {
    nft.approve("alice", "market", "1");
    fails(() => market.buy("bob", "1"), "NotListed");
    market.list("alice", "1", 20_000n);
    fails(() => market.buy("bob", "1"), "InsufficientAllowance");
    ft.approve("bob", "market", 20_000n);
    fails(() => market.buy("bob", "1"), "InsufficientBalance");
    fails(() => market.buy("alice", "1"), "SelfPurchase");
    expect(nft.ownerOf("1")).toBe("alice");
    expect(ft.balanceOf("bob")).toBe(10_000n);
  });

  it("only the seller can cancel", () => {
    nft.approve("alice", "market", "1");
    market.list("alice", "1", 100n);
    fails(() => market.cancel("bob", "1"), "NotOwner");
    market.cancel("alice", "1");
    fails(() => market.buy("bob", "1"), "NotListed");
    fails(() => market.cancel("alice", "1"), "NotListed");
  });

  it("a listing dies when the seller transfers the token away", () => {
    nft.approve("alice", "market", "1");
    market.list("alice", "1", 100n);
    nft.transferFrom("alice", "alice", "carol", "1");
    expect(market.listings()).toEqual([]);
    fails(() => market.buy("bob", "1"), "NotListed");
  });

  it("a listing dies when the approval is revoked", () => {
    nft.approve("alice", "market", "1");
    market.list("alice", "1", 100n);
    nft.approve("alice", null, "1");
    fails(() => market.buy("bob", "1"), "MarketNotApproved");
  });

  it("rejects out-of-range fee and royalty", () => {
    fails(() => setup(1001), "InvalidBps");
    fails(() => nft.mint("admin", "a", "9", "", { receiver: "r", bps: 1001 }), "InvalidBps");
  });

  it("payout parts always sum exactly to the price (rounding never leaks value)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (price, feeBps, royaltyBps) => {
          const s = setup(feeBps);
          s.nft.mint("admin", "alice", "1", "", { receiver: "artist", bps: royaltyBps });
          const p = s.market.quote("1", price);
          expect(p.fee + p.royalty + p.seller).toBe(price);
          expect(p.seller >= 0n).toBe(true);
        },
      ),
    );
  });

  it("a random buy conserves total FT supply and moves exactly one NFT", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000n }),
        fc.bigInt({ min: 0n, max: 200_000n }),
        (price, funds) => {
          const s = setup();
          s.nft.mint("admin", "alice", "1", "", { receiver: "artist", bps: 300 });
          s.ft.mint("admin", "bob", funds);
          s.ft.approve("bob", "market", funds);
          s.nft.approve("alice", "market", "1");
          s.market.list("alice", "1", price);
          const supply = s.ft.totalSupply();
          try {
            s.market.buy("bob", "1");
            expect(s.nft.ownerOf("1")).toBe("bob");
          } catch (e) {
            if (!(e instanceof ModelError)) throw e;
            expect(funds < price).toBe(true);
            expect(s.nft.ownerOf("1")).toBe("alice");
            expect(s.ft.balanceOf("bob")).toBe(funds);
          }
          expect(s.ft.totalSupply()).toBe(supply);
          expect(s.nft.totalSupply()).toBe(1);
        },
      ),
    );
  });
});
