import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionLog, Engine } from "../src";

let dir: string;
const open: Engine[] = [];
const dbPath = () => {
  dir = mkdtempSync(join(tmpdir(), "model_app-"));
  return join(dir, "world.db");
};
const engine = (p: string) => {
  const e = new Engine(p);
  open.push(e);
  return e;
};
afterEach(() => {
  while (open.length) open.pop()!.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const snap = (e: Engine) => {
  const s = e.run("x", "state.snapshot").body as { now: number };
  return { ...s, now: 0 }; // wall-clock time differs between runs
};

describe("persistence (event sourcing over SQLite)", () => {
  it("rebuilds identical state after a restart", () => {
    const p = dbPath();
    const a = engine(p);
    a.run("admin", "ft.mint", { to: "bob", amount: "5000" });
    a.run("admin", "nft.mint", { to: "alice", id: "7", uri: "ipfs://7", royalty: { receiver: "artist", bps: 500 } });
    a.run("bob", "ft.approve", { spender: "market", amount: "1000" });
    a.run("alice", "nft.approve", { spender: "market", id: "7" });
    a.run("alice", "market.list", { id: "7", price: "1000" });
    a.run("bob", "market.buy", { id: "7" });
    const before = snap(a);
    a.close();
    open.pop();

    const b = engine(p);
    expect(snap(b)).toEqual(before);
    expect((b.run("x", "nft.get", { id: "7" }).body as { owner: string }).owner).toBe("bob");
    expect(b.run("x", "ft.balance", { address: "alice" }).body).toEqual({ balance: "925" });
  });

  it("keeps working after a restart and appends to the same history", () => {
    const p = dbPath();
    const a = engine(p);
    a.run("admin", "ft.mint", { to: "bob", amount: "10" });
    a.close();
    open.pop();
    const b = engine(p);
    b.run("bob", "ft.transfer", { to: "carol", amount: "4" });
    b.close();
    open.pop();
    const c = engine(p);
    expect(c.run("x", "ft.balance", { address: "carol" }).body).toEqual({ balance: "4" });
    expect(c.run("x", "ft.supply").body).toEqual({ supply: "10" });
  });

  it("stores only successful, state-changing actions", () => {
    const p = dbPath();
    const a = engine(p);
    a.run("admin", "ft.mint", { to: "bob", amount: "10" }); // stored
    a.run("mallory", "ft.mint", { to: "m", amount: "1" }); // rejected: not stored
    a.run("bob", "ft.transfer", { to: "c", amount: "999" }); // rejected: not stored
    a.run("x", "ft.balance", { address: "bob" }); // read: not stored
    a.run("x", "state.snapshot"); // read: not stored
    a.close();
    open.pop();

    const log = new ActionLog(p);
    const rows = log.all();
    log.close();
    expect(rows.map((r) => r.name)).toEqual(["ft.mint"]);
    expect(rows[0]).toMatchObject({ caller: "admin", args: { to: "bob", amount: "10" } });
  });

  it("does not persist anything when no database is given", () => {
    const a = new Engine();
    a.run("admin", "ft.mint", { to: "bob", amount: "10" });
    expect(new Engine().run("x", "ft.supply").body).toEqual({ supply: "0" });
  });

  it("restores an auction in progress, including its clock", () => {
    const p = dbPath();
    const a = engine(p);
    a.run("admin", "ft.mint", { to: "bob", amount: "1000" });
    a.run("bob", "ft.approve", { spender: "market", amount: "1000" });
    a.run("admin", "nft.mint", { to: "alice", id: "1" });
    a.run("alice", "nft.approve", { spender: "market", id: "1" });
    a.run("alice", "market.createAuction", { id: "1", reserve: "100", duration: 60 });
    a.run("bob", "market.bid", { id: "1", amount: "300" });
    a.close();
    open.pop();

    const b = engine(p);
    const auctions = (b.run("x", "market.auctions").body as { auctions: any[] }).auctions;
    expect(auctions).toHaveLength(1);
    expect(auctions[0]).toMatchObject({ highBidder: "bob", highBid: "300" });
    expect(b.run("x", "ft.balance", { address: "market" }).body).toEqual({ balance: "300" });

    // time travel is remembered across restarts too
    b.run("admin", "time.advance", { seconds: 120 });
    const settled = b.run("x", "market.settle", { id: "1" });
    expect(settled.status).toBe(200);
    b.close();
    open.pop();

    const c = engine(p);
    expect((c.run("x", "nft.get", { id: "1" }).body as { owner: string }).owner).toBe("bob");
    expect(c.run("x", "ft.balance", { address: "alice" }).body).toEqual({ balance: "293" }); // 300 minus the 2.5% fee, rounded down (7)
  });

  it("refuses to start on a log that no longer replays", () => {
    const p = dbPath();
    const log = new ActionLog(p);
    log.append(0, "mallory", "ft.mint", { to: "m", amount: "1" }); // never could have succeeded
    log.close();
    expect(() => new Engine(p)).toThrow(/corrupt log/);
  });
});
