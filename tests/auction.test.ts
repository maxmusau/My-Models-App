import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { Clock, Ledger, NftRegistry, Marketplace, ModelError } from "../src";

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

function setup() {
  const clock = new Clock();
  clock.set(1000);
  const ft = new Ledger("Gold", "GLD", ["admin"]);
  const nft = new NftRegistry("Art", "ART", ["admin"]);
  const market = new Marketplace("market", ft, nft, "treasury", 250, clock);
  return { clock, ft, nft, market };
}

describe("Auctions", () => {
  let clock: Clock, ft: Ledger, nft: NftRegistry, market: Marketplace;

  const fund = (who: string, n: bigint) => {
    ft.mint("admin", who, n);
    ft.approve(who, "market", n);
  };

  beforeEach(() => {
    ({ clock, ft, nft, market } = setup());
    nft.mint("admin", "alice", "1", "", { receiver: "artist", bps: 500 });
    nft.approve("alice", "market", "1");
    fund("bob", 5000n);
    fund("carol", 5000n);
  });

  it("runs a full auction: escrow, outbid refund, settlement with fee and royalty", () => {
    market.createAuction("alice", "1", 100n, 60);
    market.bid("bob", "1", 200n);
    expect(ft.balanceOf("bob")).toBe(4800n);
    expect(ft.balanceOf("market")).toBe(200n);

    market.bid("carol", "1", 1000n);
    expect(ft.balanceOf("bob")).toBe(5000n); // refunded
    expect(ft.balanceOf("market")).toBe(1000n);
    expect(market.escrowed()).toBe(1000n);

    clock.advance(60);
    const s = market.settle("anyone", "1");
    expect(s).toEqual({
      sold: true,
      winner: "carol",
      payout: { fee: 25n, royalty: 50n, seller: 925n },
    });
    expect(nft.ownerOf("1")).toBe("carol");
    expect(ft.balanceOf("alice")).toBe(925n);
    expect(ft.balanceOf("artist")).toBe(50n);
    expect(ft.balanceOf("treasury")).toBe(25n);
    expect(ft.balanceOf("market")).toBe(0n);
    expect(market.auctions()).toEqual([]);
  });

  it("enforces reserve, minimum raise, timing and seller restrictions", () => {
    market.createAuction("alice", "1", 100n, 60);
    fails(() => market.bid("bob", "1", 99n), "BidTooLow");
    fails(() => market.bid("alice", "1", 200n), "SelfPurchase");
    market.bid("bob", "1", 100n);
    fails(() => market.bid("carol", "1", 100n), "BidTooLow"); // must strictly beat the high bid
    fails(() => market.settle("x", "1"), "AuctionNotEnded");
    clock.advance(60);
    fails(() => market.bid("carol", "1", 500n), "AuctionEnded");
  });

  it("needs allowance and balance to bid, and changes nothing when it fails", () => {
    market.createAuction("alice", "1", 100n, 60);
    ft.approve("bob", "market", 50n);
    fails(() => market.bid("bob", "1", 100n), "InsufficientAllowance");
    ft.approve("bob", "market", 10_000n);
    fails(() => market.bid("bob", "1", 6000n), "InsufficientBalance");
    expect(ft.balanceOf("bob")).toBe(5000n);
    expect(ft.balanceOf("market")).toBe(0n);
  });

  it("ends with no sale when nobody bid", () => {
    market.createAuction("alice", "1", 100n, 60);
    clock.advance(61);
    expect(market.settle("x", "1")).toEqual({ sold: false, winner: null, payout: null });
    expect(nft.ownerOf("1")).toBe("alice");
  });

  it("refunds the top bidder if the seller moved the token away", () => {
    market.createAuction("alice", "1", 100n, 60);
    market.bid("bob", "1", 300n);
    nft.transferFrom("alice", "alice", "dave", "1");
    expect(market.auctions()).toEqual([]);
    fails(() => market.bid("carol", "1", 400n), "NoAuction");
    clock.advance(60);
    expect(market.settle("x", "1").sold).toBe(false);
    expect(ft.balanceOf("bob")).toBe(5000n);
    expect(ft.balanceOf("market")).toBe(0n);
  });

  it("refunds the top bidder if the approval was revoked", () => {
    market.createAuction("alice", "1", 100n, 60);
    market.bid("bob", "1", 300n);
    clock.advance(60);
    nft.approve("alice", null, "1");
    expect(market.settle("x", "1").sold).toBe(false);
    expect(ft.balanceOf("bob")).toBe(5000n);
    expect(nft.ownerOf("1")).toBe("alice");
  });

  it("only the seller can cancel, and only before the first bid", () => {
    market.createAuction("alice", "1", 100n, 60);
    fails(() => market.cancelAuction("bob", "1"), "NotOwner");
    market.bid("bob", "1", 100n);
    fails(() => market.cancelAuction("alice", "1"), "HasBids");
    const m2 = setup();
    m2.nft.mint("admin", "alice", "9");
    m2.nft.approve("alice", "market", "9");
    m2.market.createAuction("alice", "9", 1n, 10);
    m2.market.cancelAuction("alice", "9");
    fails(() => m2.market.bid("bob", "9", 5n), "NoAuction");
  });

  it("a token cannot be listed and auctioned at the same time", () => {
    market.list("alice", "1", 100n);
    fails(() => market.createAuction("alice", "1", 100n, 60), "AlreadyListed");
    market.cancel("alice", "1");
    market.createAuction("alice", "1", 100n, 60);
    fails(() => market.list("alice", "1", 100n), "AuctionExists");
    fails(() => market.createAuction("alice", "1", 100n, 60), "AuctionExists");
  });

  it("validates reserve and duration", () => {
    fails(() => market.createAuction("alice", "1", 0n, 60), "InvalidPrice");
    fails(() => market.createAuction("alice", "1", 100n, 0), "InvalidDuration");
    fails(() => market.createAuction("alice", "1", 100n, 1.5), "InvalidDuration");
    fails(() => market.createAuction("bob", "1", 100n, 60), "NotOwner");
  });

  it("escrow always equals the sum of open high bids, and FT supply never changes", () => {
    const bidder = fc.constantFrom("bob", "carol", "dave");
    const op = fc.oneof(
      fc.tuple(fc.constant("bid" as const), bidder, fc.bigInt({ min: 0n, max: 400n })),
      fc.tuple(fc.constant("tick" as const), fc.integer({ min: 0, max: 40 })),
      fc.tuple(fc.constant("settle" as const)),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        const s = setup();
        s.nft.mint("admin", "alice", "1");
        s.nft.approve("alice", "market", "1");
        for (const b of ["bob", "carol", "dave"]) {
          s.ft.mint("admin", b, 300n);
          s.ft.approve(b, "market", 300n);
        }
        const supply = s.ft.totalSupply();
        s.market.createAuction("alice", "1", 10n, 50);
        for (const o of ops) {
          try {
            if (o[0] === "bid") s.market.bid(o[1], "1", o[2]);
            else if (o[0] === "tick") s.clock.advance(o[1]);
            else s.market.settle("x", "1");
          } catch (e) {
            if (!(e instanceof ModelError)) throw e;
          }
          expect(s.ft.balanceOf("market")).toBe(s.market.escrowed());
          expect(s.ft.totalSupply()).toBe(supply);
          expect(s.nft.totalSupply()).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });
});
