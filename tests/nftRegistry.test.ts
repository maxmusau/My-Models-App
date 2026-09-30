import { describe, it, expect, beforeEach } from "vitest";
import { NftRegistry, ModelError } from "../src";

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

describe("NftRegistry (NFT)", () => {
  let r: NftRegistry;
  beforeEach(() => {
    r = new NftRegistry("Art", "ART", ["admin"]);
    r.mint("admin", "alice", "1", "ipfs://one");
  });

  it("mints a unique token with owner and URI", () => {
    expect(r.ownerOf("1")).toBe("alice");
    expect(r.tokenURI("1")).toBe("ipfs://one");
    expect(r.totalSupply()).toBe(1);
    expect(r.balanceOf("alice")).toBe(1);
  });

  it("rejects duplicate ids and non-minters", () => {
    fails(() => r.mint("admin", "bob", "1"), "TokenExists");
    fails(() => r.mint("mallory", "mallory", "2"), "NotMinter");
  });

  it("owner can transfer", () => {
    r.transferFrom("alice", "alice", "bob", "1");
    expect(r.ownerOf("1")).toBe("bob");
  });

  it("rejects transfer by a stranger", () => {
    fails(() => r.transferFrom("mallory", "alice", "mallory", "1"), "NotOwnerNorApproved");
    expect(r.ownerOf("1")).toBe("alice");
  });

  it("rejects transfer with the wrong from address", () => {
    fails(() => r.transferFrom("alice", "bob", "carol", "1"), "WrongOwner");
  });

  it("approved spender can transfer, and approval is cleared afterwards", () => {
    r.approve("alice", "spender", "1");
    expect(r.getApproved("1")).toBe("spender");
    r.transferFrom("spender", "alice", "bob", "1");
    expect(r.ownerOf("1")).toBe("bob");
    expect(r.getApproved("1")).toBeNull();
    fails(() => r.transferFrom("spender", "bob", "spender", "1"), "NotOwnerNorApproved");
  });

  it("operator approved for all can transfer and approve", () => {
    r.setApprovalForAll("alice", "op", true);
    r.approve("op", "x", "1");
    r.transferFrom("op", "alice", "bob", "1");
    expect(r.ownerOf("1")).toBe("bob");
    r.setApprovalForAll("alice", "op", false);
    expect(r.isApprovedForAll("alice", "op")).toBe(false);
  });

  it("only owner or operator can approve", () => {
    fails(() => r.approve("mallory", "mallory", "1"), "NotOwnerNorApproved");
  });

  it("burn removes token and allows the id to be re-minted", () => {
    r.burn("alice", "1");
    expect(r.exists("1")).toBe(false);
    expect(r.totalSupply()).toBe(0);
    fails(() => r.ownerOf("1"), "TokenNotFound");
    r.mint("admin", "bob", "1");
    expect(r.ownerOf("1")).toBe("bob");
    expect(r.getApproved("1")).toBeNull();
  });

  it("rejects operations on unknown tokens", () => {
    fails(() => r.transferFrom("alice", "alice", "bob", "nope"), "TokenNotFound");
    fails(() => r.burn("alice", "nope"), "TokenNotFound");
  });
});
