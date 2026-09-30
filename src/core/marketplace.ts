import { Address, ModelError, assertAddress } from "./errors";
import { Clock } from "./clock";
import { Ledger } from "./ledger";
import { NftRegistry, TokenId } from "./nftRegistry";

export const BPS = 10_000n;
export const MAX_FEE_BPS = 1000; // 10%

export interface Listing {
  id: TokenId;
  seller: Address;
  price: bigint;
}

export interface Auction {
  id: TokenId;
  seller: Address;
  reserve: bigint;
  endsAt: number;
  highBidder: Address | null;
  highBid: bigint;
}

export interface Settlement {
  sold: boolean;
  winner: Address | null;
  payout: Payout | null;
}

export interface Payout {
  fee: bigint;
  royalty: bigint;
  seller: bigint;
}

/**
 * Fixed-price marketplace: NFTs are sold for FTs.
 * The marketplace acts as an approved operator, so sellers must approve `address` first,
 * and buyers must give `address` an FT allowance of at least the price.
 *
 * It also runs English auctions. Bids are held in escrow by the marketplace (its own FT balance),
 * so a winning bid can always be paid; outbid bidders are refunded immediately.
 */
export class Marketplace {
  private book = new Map<TokenId, Listing>();
  private auctionBook = new Map<TokenId, Auction>();

  constructor(
    public readonly address: Address,
    private ledger: Ledger,
    private registry: NftRegistry,
    public readonly treasury: Address,
    public readonly feeBps: number,
    private clock: Clock = new Clock(),
  ) {
    assertAddress(address);
    assertAddress(treasury);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
      throw new ModelError("InvalidBps");
    }
  }

  /** Split of a sale price. The three parts always sum to exactly `price`. */
  quote(id: TokenId, price: bigint): Payout {
    const fee = (price * BigInt(this.feeBps)) / BPS;
    const r = this.registry.royaltyInfo(id);
    const royalty = r ? (price * BigInt(r.bps)) / BPS : 0n;
    return { fee, royalty, seller: price - fee - royalty };
  }

  getListing(id: TokenId): Listing | null {
    const l = this.book.get(id);
    return l && this.isLive(l) ? l : null;
  }

  listings(): Listing[] {
    return [...this.book.values()].filter((l) => this.isLive(l));
  }

  list(seller: Address, id: TokenId, price: bigint): void {
    if (typeof price !== "bigint" || price <= 0n) throw new ModelError("InvalidPrice");
    if (this.registry.ownerOf(id) !== seller) throw new ModelError("NotOwner");
    this.requireApproved(seller, id);
    if (this.getListing(id)) throw new ModelError("AlreadyListed");
    if (this.getAuction(id)) throw new ModelError("AuctionExists");
    this.book.set(id, { id, seller, price });
  }

  cancel(caller: Address, id: TokenId): void {
    const l = this.book.get(id);
    if (!l) throw new ModelError("NotListed");
    if (l.seller !== caller) throw new ModelError("NotOwner");
    this.book.delete(id);
  }

  buy(buyer: Address, id: TokenId): Payout {
    const l = this.getListing(id);
    if (!l) throw new ModelError("NotListed");
    if (buyer === l.seller) throw new ModelError("SelfPurchase");
    this.requireApproved(l.seller, id);
    if (this.ledger.allowance(buyer, this.address) < l.price) {
      throw new ModelError("InsufficientAllowance");
    }
    if (this.ledger.balanceOf(buyer) < l.price) throw new ModelError("InsufficientBalance");

    const p = this.quote(id, l.price);
    const royaltyTo = this.registry.royaltyInfo(id)?.receiver;

    // All checks passed above; from here on nothing can fail.
    this.registry.transferFrom(this.address, l.seller, buyer, id);
    this.ledger.transferFrom(this.address, buyer, this.treasury, p.fee);
    if (royaltyTo) this.ledger.transferFrom(this.address, buyer, royaltyTo, p.royalty);
    this.ledger.transferFrom(this.address, buyer, l.seller, p.seller);
    this.book.delete(id);
    return p;
  }

  // ---- auctions ----

  getAuction(id: TokenId): Auction | null {
    const a = this.auctionBook.get(id);
    return a && this.isLive(a) ? a : null;
  }

  auctions(): Auction[] {
    return [...this.auctionBook.values()].filter((a) => this.isLive(a));
  }

  /** FT currently held in escrow for open auctions. */
  escrowed(): bigint {
    let t = 0n;
    for (const a of this.auctionBook.values()) t += a.highBid;
    return t;
  }

  createAuction(seller: Address, id: TokenId, reserve: bigint, durationSeconds: number): void {
    if (typeof reserve !== "bigint" || reserve <= 0n) throw new ModelError("InvalidPrice");
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
      throw new ModelError("InvalidDuration");
    }
    if (this.registry.ownerOf(id) !== seller) throw new ModelError("NotOwner");
    this.requireApproved(seller, id);
    if (this.getListing(id)) throw new ModelError("AlreadyListed");
    if (this.getAuction(id)) throw new ModelError("AuctionExists");
    // A dead auction may still hold a bid; settle it first so escrow is never orphaned.
    if (this.auctionBook.has(id)) this.settle(seller, id);
    this.auctionBook.set(id, {
      id,
      seller,
      reserve,
      endsAt: this.clock.now() + durationSeconds,
      highBidder: null,
      highBid: 0n,
    });
  }

  bid(bidder: Address, id: TokenId, amount: bigint): void {
    const a = this.getAuction(id);
    if (!a) throw new ModelError("NoAuction");
    if (this.clock.now() >= a.endsAt) throw new ModelError("AuctionEnded");
    if (bidder === a.seller) throw new ModelError("SelfPurchase");
    if (typeof amount !== "bigint" || amount < a.reserve || amount <= a.highBid) {
      throw new ModelError("BidTooLow");
    }
    if (this.ledger.allowance(bidder, this.address) < amount) {
      throw new ModelError("InsufficientAllowance");
    }
    if (this.ledger.balanceOf(bidder) < amount) throw new ModelError("InsufficientBalance");

    const prev = a.highBidder;
    const prevBid = a.highBid;
    this.ledger.transferFrom(this.address, bidder, this.address, amount); // escrow
    if (prev) this.ledger.transfer(this.address, prev, prevBid); // refund
    a.highBidder = bidder;
    a.highBid = amount;
  }

  /** Anyone can settle once the auction has ended. Never throws on a stale auction: it refunds. */
  settle(_caller: Address, id: TokenId): Settlement {
    const a = this.auctionBook.get(id);
    if (!a) throw new ModelError("NoAuction");
    if (this.clock.now() < a.endsAt && this.isLive(a)) throw new ModelError("AuctionNotEnded");
    this.auctionBook.delete(id);
    if (!a.highBidder) return { sold: false, winner: null, payout: null };

    const approved =
      this.registry.getApproved(id) === this.address ||
      this.registry.isApprovedForAll(a.seller, this.address);
    if (!this.isLive(a) || !approved) {
      this.ledger.transfer(this.address, a.highBidder, a.highBid); // can't deliver: refund
      return { sold: false, winner: null, payout: null };
    }

    const p = this.quote(id, a.highBid);
    const royaltyTo = this.registry.royaltyInfo(id)?.receiver;
    this.registry.transferFrom(this.address, a.seller, a.highBidder, id);
    this.ledger.transfer(this.address, this.treasury, p.fee);
    if (royaltyTo) this.ledger.transfer(this.address, royaltyTo, p.royalty);
    this.ledger.transfer(this.address, a.seller, p.seller);
    return { sold: true, winner: a.highBidder, payout: p };
  }

  cancelAuction(caller: Address, id: TokenId): void {
    const a = this.auctionBook.get(id);
    if (!a) throw new ModelError("NoAuction");
    if (a.seller !== caller) throw new ModelError("NotOwner");
    if (a.highBidder) throw new ModelError("HasBids");
    this.auctionBook.delete(id);
  }

  /** A listing is live only while the seller still owns the token. */
  private isLive(l: { id: TokenId; seller: Address }): boolean {
    return this.registry.exists(l.id) && this.registry.ownerOf(l.id) === l.seller;
  }

  private requireApproved(owner: Address, id: TokenId): void {
    if (
      this.registry.getApproved(id) !== this.address &&
      !this.registry.isApprovedForAll(owner, this.address)
    ) {
      throw new ModelError("MarketNotApproved");
    }
  }
}
