import { Address, ModelError, assertAddress } from "./errors";

/** Fungible token ledger (ERC-20 style). Amounts are non-negative bigints. */
export class Ledger {
  private balances = new Map<Address, bigint>();
  private allowances = new Map<Address, Map<Address, bigint>>();
  private supply = 0n;
  private minters: Set<Address>;

  constructor(
    public readonly name: string,
    public readonly symbol: string,
    minters: Address[] = [],
  ) {
    this.minters = new Set(minters);
  }

  totalSupply(): bigint {
    return this.supply;
  }

  balanceOf(a: Address): bigint {
    return this.balances.get(a) ?? 0n;
  }

  allowance(owner: Address, spender: Address): bigint {
    return this.allowances.get(owner)?.get(spender) ?? 0n;
  }

  /** All non-zero holders; used by invariant checks. */
  holders(): ReadonlyMap<Address, bigint> {
    return this.balances;
  }

  mint(caller: Address, to: Address, amount: bigint): void {
    if (!this.minters.has(caller)) throw new ModelError("NotMinter");
    assertAddress(to);
    assertAmount(amount);
    this.supply += amount;
    this.credit(to, amount);
  }

  burn(from: Address, amount: bigint): void {
    assertAddress(from);
    assertAmount(amount);
    this.debit(from, amount);
    this.supply -= amount;
  }

  transfer(from: Address, to: Address, amount: bigint): void {
    assertAddress(from);
    assertAddress(to);
    assertAmount(amount);
    this.debit(from, amount);
    this.credit(to, amount);
  }

  approve(owner: Address, spender: Address, amount: bigint): void {
    assertAddress(owner);
    assertAddress(spender);
    assertAmount(amount);
    let m = this.allowances.get(owner);
    if (!m) this.allowances.set(owner, (m = new Map()));
    m.set(spender, amount);
  }

  transferFrom(spender: Address, from: Address, to: Address, amount: bigint): void {
    assertAddress(spender);
    assertAddress(from);
    assertAddress(to);
    assertAmount(amount);
    const allowed = this.allowance(from, spender);
    if (allowed < amount) throw new ModelError("InsufficientAllowance");
    if (this.balanceOf(from) < amount) throw new ModelError("InsufficientBalance");
    if (amount > 0n) this.allowances.get(from)!.set(spender, allowed - amount);
    this.debit(from, amount);
    this.credit(to, amount);
  }

  private debit(a: Address, amount: bigint): void {
    const bal = this.balanceOf(a);
    if (bal < amount) throw new ModelError("InsufficientBalance");
    this.setBalance(a, bal - amount);
  }

  private credit(a: Address, amount: bigint): void {
    this.setBalance(a, this.balanceOf(a) + amount);
  }

  private setBalance(a: Address, v: bigint): void {
    if (v === 0n) this.balances.delete(a);
    else this.balances.set(a, v);
  }
}

function assertAmount(n: bigint): void {
  if (typeof n !== "bigint" || n < 0n) throw new ModelError("InvalidAmount");
}
