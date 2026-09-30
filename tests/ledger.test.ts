import { describe, it, expect, beforeEach } from "vitest";
import { Ledger, ModelError } from "../src";

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

describe("Ledger (FT)", () => {
  let l: Ledger;
  beforeEach(() => {
    l = new Ledger("Gold", "GLD", ["admin"]);
  });

  it("mints to an address and increases supply", () => {
    l.mint("admin", "alice", 100n);
    expect(l.balanceOf("alice")).toBe(100n);
    expect(l.totalSupply()).toBe(100n);
  });

  it("rejects minting by a non-minter", () => {
    fails(() => l.mint("mallory", "mallory", 1n), "NotMinter");
  });

  it("rejects negative amounts", () => {
    fails(() => l.mint("admin", "alice", -1n), "InvalidAmount");
  });

  it("transfers between accounts", () => {
    l.mint("admin", "alice", 100n);
    l.transfer("alice", "bob", 40n);
    expect(l.balanceOf("alice")).toBe(60n);
    expect(l.balanceOf("bob")).toBe(40n);
    expect(l.totalSupply()).toBe(100n);
  });

  it("rejects overdraft and leaves state unchanged", () => {
    l.mint("admin", "alice", 10n);
    fails(() => l.transfer("alice", "bob", 11n), "InsufficientBalance");
    expect(l.balanceOf("alice")).toBe(10n);
    expect(l.balanceOf("bob")).toBe(0n);
  });

  it("burns and decreases supply", () => {
    l.mint("admin", "alice", 10n);
    l.burn("alice", 4n);
    expect(l.balanceOf("alice")).toBe(6n);
    expect(l.totalSupply()).toBe(6n);
    fails(() => l.burn("alice", 7n), "InsufficientBalance");
  });

  it("supports allowances via transferFrom", () => {
    l.mint("admin", "alice", 100n);
    l.approve("alice", "spender", 30n);
    l.transferFrom("spender", "alice", "bob", 20n);
    expect(l.allowance("alice", "spender")).toBe(10n);
    expect(l.balanceOf("bob")).toBe(20n);
    fails(() => l.transferFrom("spender", "alice", "bob", 11n), "InsufficientAllowance");
  });

  it("does not spend allowance when balance is insufficient", () => {
    l.mint("admin", "alice", 5n);
    l.approve("alice", "spender", 50n);
    fails(() => l.transferFrom("spender", "alice", "bob", 10n), "InsufficientBalance");
    expect(l.allowance("alice", "spender")).toBe(50n);
  });

  it("allows zero-amount transferFrom without any prior approval (regression)", () => {
    l.transferFrom("alice", "alice", "alice", 0n);
    expect(l.allowance("alice", "alice")).toBe(0n);
  });

  it("allows zero-amount transfers", () => {
    l.transfer("alice", "bob", 0n);
    expect(l.totalSupply()).toBe(0n);
  });
});
