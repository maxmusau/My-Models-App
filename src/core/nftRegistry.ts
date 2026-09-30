import { Address, ModelError, assertAddress } from "./errors";

export type TokenId = string;

export const MAX_ROYALTY_BPS = 1000; // 10%

export interface Royalty {
  receiver: Address;
  bps: number;
}

/** Non-fungible token registry (ERC-721 style). */
export class NftRegistry {
  private owners = new Map<TokenId, Address>();
  private uris = new Map<TokenId, string>();
  private approvals = new Map<TokenId, Address>();
  private royalties = new Map<TokenId, Royalty>();
  private operators = new Map<Address, Set<Address>>();
  private minters: Set<Address>;

  constructor(
    public readonly name: string,
    public readonly symbol: string,
    minters: Address[] = [],
  ) {
    this.minters = new Set(minters);
  }

  totalSupply(): number {
    return this.owners.size;
  }

  exists(id: TokenId): boolean {
    return this.owners.has(id);
  }

  ownerOf(id: TokenId): Address {
    const o = this.owners.get(id);
    if (o === undefined) throw new ModelError("TokenNotFound");
    return o;
  }

  tokenURI(id: TokenId): string {
    this.ownerOf(id);
    return this.uris.get(id) ?? "";
  }

  balanceOf(a: Address): number {
    let n = 0;
    for (const o of this.owners.values()) if (o === a) n++;
    return n;
  }

  tokensOf(a: Address): TokenId[] {
    return [...this.owners].filter(([, o]) => o === a).map(([id]) => id);
  }

  getApproved(id: TokenId): Address | null {
    this.ownerOf(id);
    return this.approvals.get(id) ?? null;
  }

  isApprovedForAll(owner: Address, operator: Address): boolean {
    return this.operators.get(owner)?.has(operator) ?? false;
  }

  /** All token ids; used by invariant checks. */
  allTokens(): TokenId[] {
    return [...this.owners.keys()];
  }

  /** Royalty for secondary sales; none if the token was minted without one. */
  royaltyInfo(id: TokenId): Royalty | null {
    this.ownerOf(id);
    return this.royalties.get(id) ?? null;
  }

  mint(caller: Address, to: Address, id: TokenId, uri = "", royalty?: Royalty): void {
    if (!this.minters.has(caller)) throw new ModelError("NotMinter");
    assertAddress(to);
    if (this.owners.has(id)) throw new ModelError("TokenExists");
    if (royalty) {
      assertAddress(royalty.receiver);
      if (!Number.isInteger(royalty.bps) || royalty.bps < 0 || royalty.bps > MAX_ROYALTY_BPS) {
        throw new ModelError("InvalidBps");
      }
      this.royalties.set(id, royalty);
    }
    this.owners.set(id, to);
    this.uris.set(id, uri);
  }

  burn(caller: Address, id: TokenId): void {
    const owner = this.ownerOf(id);
    this.requireAuthorized(caller, owner, id);
    this.owners.delete(id);
    this.uris.delete(id);
    this.approvals.delete(id);
    this.royalties.delete(id);
  }

  transferFrom(caller: Address, from: Address, to: Address, id: TokenId): void {
    assertAddress(to);
    const owner = this.ownerOf(id);
    if (owner !== from) throw new ModelError("WrongOwner");
    this.requireAuthorized(caller, owner, id);
    this.approvals.delete(id);
    this.owners.set(id, to);
  }

  approve(caller: Address, spender: Address | null, id: TokenId): void {
    const owner = this.ownerOf(id);
    if (caller !== owner && !this.isApprovedForAll(owner, caller)) {
      throw new ModelError("NotOwnerNorApproved");
    }
    if (spender === owner) throw new ModelError("SelfApproval");
    if (spender === null) this.approvals.delete(id);
    else this.approvals.set(id, spender);
  }

  setApprovalForAll(owner: Address, operator: Address, approved: boolean): void {
    assertAddress(operator);
    if (owner === operator) throw new ModelError("SelfApproval");
    let s = this.operators.get(owner);
    if (!s) this.operators.set(owner, (s = new Set()));
    if (approved) s.add(operator);
    else s.delete(operator);
  }

  private requireAuthorized(caller: Address, owner: Address, id: TokenId): void {
    if (
      caller !== owner &&
      this.approvals.get(id) !== caller &&
      !this.isApprovedForAll(owner, caller)
    ) {
      throw new ModelError("NotOwnerNorApproved");
    }
  }
}
