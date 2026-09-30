import { ModelError } from "../core/errors";
import { Clock } from "../core/clock";
import { Ledger } from "../core/ledger";
import { Auction, Marketplace } from "../core/marketplace";
import { NftRegistry, Royalty } from "../core/nftRegistry";

export const ADMIN = "admin";
export const MARKET = "market";
export const TREASURY = "treasury";

/** One self-contained universe: an FT, an NFT collection and a marketplace. */
export class World {
  readonly ft: Ledger;
  readonly nft: NftRegistry;
  readonly market: Marketplace;

  constructor(
    feeBps = 250,
    readonly clock = new Clock(),
  ) {
    this.ft = new Ledger("Gold", "GLD", [ADMIN]);
    this.nft = new NftRegistry("Art", "ART", [ADMIN]);
    this.market = new Marketplace(MARKET, this.ft, this.nft, TREASURY, feeBps, clock);
  }
}

export type Json = unknown;
export type Args = Record<string, unknown>;

export interface Result {
  status: number;
  body: Json;
}

class BadRequest extends Error {}

const str = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || v === "") throw new BadRequest(`missing or invalid "${k}"`);
  return v;
};

const big = (a: Args, k: string): bigint => {
  const v = a[k];
  if (typeof v !== "string" && typeof v !== "number") throw new BadRequest(`missing "${k}"`);
  try {
    return BigInt(v);
  } catch {
    throw new BadRequest(`invalid "${k}"`);
  }
};

function royalty(a: Args): Royalty | undefined {
  const r = a["royalty"];
  if (r === undefined || r === null) return undefined;
  const o = r as Args;
  if (typeof o !== "object" || typeof o["bps"] !== "number") {
    throw new BadRequest('invalid "royalty"');
  }
  return { receiver: str(o, "receiver"), bps: o["bps"] };
}

/** Transport-agnostic actions, shared by the REST server and the CLI. */
type Action = (w: World, caller: string, a: Args) => Json;

export const actions: Record<string, Action> = {
  "ft.mint": (w, c, a) => void w.ft.mint(c, str(a, "to"), big(a, "amount")),
  "ft.burn": (w, c, a) => void w.ft.burn(c, big(a, "amount")),
  "ft.transfer": (w, c, a) => void w.ft.transfer(c, str(a, "to"), big(a, "amount")),
  "ft.approve": (w, c, a) => void w.ft.approve(c, str(a, "spender"), big(a, "amount")),
  "ft.transferFrom": (w, c, a) =>
    void w.ft.transferFrom(c, str(a, "from"), str(a, "to"), big(a, "amount")),
  "ft.balance": (w, _c, a) => ({ balance: w.ft.balanceOf(str(a, "address")).toString() }),
  "ft.supply": (w) => ({ supply: w.ft.totalSupply().toString() }),

  "nft.mint": (w, c, a) =>
    void w.nft.mint(c, str(a, "to"), str(a, "id"), (a["uri"] as string) ?? "", royalty(a)),
  "nft.burn": (w, c, a) => void w.nft.burn(c, str(a, "id")),
  "nft.transfer": (w, c, a) =>
    void w.nft.transferFrom(c, str(a, "from"), str(a, "to"), str(a, "id")),
  "nft.approve": (w, c, a) =>
    void w.nft.approve(c, a["spender"] == null ? null : str(a, "spender"), str(a, "id")),
  "nft.approveAll": (w, c, a) =>
    void w.nft.setApprovalForAll(c, str(a, "operator"), a["approved"] !== false),
  "nft.get": (w, _c, a) => {
    const id = str(a, "id");
    return {
      id,
      owner: w.nft.ownerOf(id),
      uri: w.nft.tokenURI(id),
      approved: w.nft.getApproved(id),
      royalty: w.nft.royaltyInfo(id),
    };
  },
  "nft.owned": (w, _c, a) => ({ tokens: w.nft.tokensOf(str(a, "address")) }),

  "market.list": (w, c, a) => void w.market.list(c, str(a, "id"), big(a, "price")),
  "market.cancel": (w, c, a) => void w.market.cancel(c, str(a, "id")),
  "market.buy": (w, c, a) => {
    const p = w.market.buy(c, str(a, "id"));
    return { fee: p.fee.toString(), royalty: p.royalty.toString(), seller: p.seller.toString() };
  },
  "market.createAuction": (w, c, a) =>
    void w.market.createAuction(c, str(a, "id"), big(a, "reserve"), Number(a["duration"])),
  "market.bid": (w, c, a) => void w.market.bid(c, str(a, "id"), big(a, "amount")),
  "market.cancelAuction": (w, c, a) => void w.market.cancelAuction(c, str(a, "id")),
  "market.settle": (w, c, a) => {
    const s = w.market.settle(c, str(a, "id"));
    return {
      sold: s.sold,
      winner: s.winner,
      payout: s.payout && {
        fee: s.payout.fee.toString(),
        royalty: s.payout.royalty.toString(),
        seller: s.payout.seller.toString(),
      },
    };
  },
  "market.auctions": (w) => ({ auctions: w.market.auctions().map(auctionJson) }),

  /** Demo/testing only: moves the world's clock forward. Admin only. */
  "time.advance": (w, c, a) => {
    if (c !== ADMIN) throw new ModelError("NotMinter");
    const n = Number(a["seconds"]);
    if (!Number.isInteger(n) || n < 0) throw new BadRequest('invalid "seconds"');
    w.clock.advance(n);
    return { now: w.clock.now() };
  },

  /** Everything in one read: what the web UI renders. */
  "state.snapshot": (w) => ({
    now: w.clock.now(),
    feeBps: w.market.feeBps,
    ft: {
      name: w.ft.name,
      symbol: w.ft.symbol,
      supply: w.ft.totalSupply().toString(),
      balances: Object.fromEntries([...w.ft.holders()].map(([k, v]) => [k, v.toString()])),
    },
    nfts: w.nft.allTokens().map((id) => ({
      id,
      owner: w.nft.ownerOf(id),
      uri: w.nft.tokenURI(id),
      approved: w.nft.getApproved(id),
      royalty: w.nft.royaltyInfo(id),
    })),
    listings: w.market.listings().map((l) => ({ ...l, price: l.price.toString() })),
    auctions: w.market.auctions().map(auctionJson),
  }),

  "market.listings": (w) => ({
    listings: w.market.listings().map((l) => ({ ...l, price: l.price.toString() })),
  }),
};

function auctionJson(a: Auction) {
  return { ...a, reserve: a.reserve.toString(), highBid: a.highBid.toString() };
}

/** Actions that never change state. Everything else is recorded when persistence is on. */
export const READ_ONLY = new Set([
  "ft.balance",
  "ft.supply",
  "nft.get",
  "nft.owned",
  "market.listings",
  "market.auctions",
  "state.snapshot",
]);

const STATUS: Record<string, number> = {
  AuctionExists: 409,
  NoAuction: 404,
  NotMinter: 403,
  NotOwner: 403,
  NotOwnerNorApproved: 403,
  TokenNotFound: 404,
  NotListed: 404,
  TokenExists: 409,
  AlreadyListed: 409,
};

/** Run an action and map domain errors to an HTTP-style result. */
export function execute(w: World, caller: string, name: string, args: Args): Result {
  const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
  if (!action) return { status: 404, body: { error: "UnknownAction", action: name } };
  try {
    const out = action(w, caller, args);
    return { status: 200, body: out ?? { ok: true } };
  } catch (e) {
    if (e instanceof ModelError) {
      return { status: STATUS[e.code] ?? 400, body: { error: e.code } };
    }
    if (e instanceof BadRequest) {
      return { status: 400, body: { error: "BadRequest", message: e.message } };
    }
    throw e;
  }
}
