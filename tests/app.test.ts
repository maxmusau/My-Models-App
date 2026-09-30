import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer, Engine } from "../src";
import { runLine } from "../src/app/cli";

describe("REST API", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer(new Engine());
    await new Promise<void>((ok) => server.listen(0, ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  const call = async (caller: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "x-caller": caller, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  it("runs a full mint -> list -> buy story over HTTP", async () => {
    expect((await call("admin", "POST", "/ft/mint", { to: "bob", amount: "5000" })).status).toBe(200);
    expect(
      (
        await call("admin", "POST", "/nft/mint", {
          to: "alice",
          id: "7",
          uri: "ipfs://7",
          royalty: { receiver: "artist", bps: 500 },
        })
      ).status,
    ).toBe(200);
    await call("bob", "POST", "/ft/approve", { spender: "market", amount: "1000" });
    await call("alice", "POST", "/nft/approve", { spender: "market", id: "7" });
    await call("alice", "POST", "/market/list", { id: "7", price: "1000" });

    const listings = await call("anyone", "GET", "/market/listings");
    expect(listings.body.listings).toEqual([{ id: "7", seller: "alice", price: "1000" }]);

    const buy = await call("bob", "POST", "/market/buy", { id: "7" });
    expect(buy.body).toEqual({ fee: "25", royalty: "50", seller: "925" });

    expect((await call("x", "GET", "/nft/get?id=7")).body.owner).toBe("bob");
    expect((await call("x", "GET", "/ft/balance?address=alice")).body.balance).toBe("925");
    expect((await call("x", "GET", "/ft/supply")).body.supply).toBe("5000");
  });

  it("serves the web UI at / and a full state snapshot", async () => {
    const page = await fetch(base + "/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("<title>model_app</title>");

    const s = (await call("ui", "GET", "/state/snapshot")).body;
    expect(s.ft.symbol).toBe("GLD");
    expect(Array.isArray(s.nfts)).toBe(true);
    expect(Array.isArray(s.auctions)).toBe(true);
  });

  it("runs an auction over HTTP, using time.advance to reach the end", async () => {
    await call("admin", "POST", "/ft/mint", { to: "dora", amount: "1000" });
    await call("dora", "POST", "/ft/approve", { spender: "market", amount: "1000" });
    await call("admin", "POST", "/nft/mint", { to: "eve", id: "auc1" });
    await call("eve", "POST", "/nft/approve", { spender: "market", id: "auc1" });
    expect((await call("eve", "POST", "/market/createAuction", { id: "auc1", reserve: "100", duration: 60 })).status).toBe(200);
    expect((await call("dora", "POST", "/market/bid", { id: "auc1", amount: "400" })).status).toBe(200);

    expect((await call("x", "POST", "/market/settle", { id: "auc1" })).body).toEqual({ error: "AuctionNotEnded" });
    expect((await call("dora", "POST", "/time/advance", { seconds: 61 })).status).toBe(403); // admin only
    expect((await call("admin", "POST", "/time/advance", { seconds: 61 })).status).toBe(200);

    const done = await call("x", "POST", "/market/settle", { id: "auc1" });
    expect(done.body.sold).toBe(true);
    expect(done.body.winner).toBe("dora");
    expect((await call("x", "GET", "/nft/get?id=auc1")).body.owner).toBe("dora");
    expect((await call("x", "GET", "/ft/balance?address=eve")).body.balance).toBe("390"); // 400 - 10 fee
  });

  it("maps domain errors to status codes", async () => {
    expect((await call("mallory", "POST", "/ft/mint", { to: "m", amount: "1" })).status).toBe(403);
    expect((await call("x", "GET", "/nft/get?id=nope")).status).toBe(404);
    expect((await call("alice", "POST", "/ft/transfer", { to: "b", amount: "999999" })).status).toBe(400);
    expect((await call("admin", "POST", "/nft/mint", { to: "a", id: "7" })).status).toBe(409);
  });

  it("rejects malformed input and unknown routes without crashing", async () => {
    expect((await call("a", "POST", "/ft/transfer", { to: "b", amount: "abc" })).status).toBe(400);
    expect((await call("a", "POST", "/ft/transfer", { amount: "1" })).status).toBe(400);
    expect((await call("a", "GET", "/nope/nope")).status).toBe(404);
    expect((await call("a", "GET", "/constructor/toString")).status).toBe(404);
    expect((await call("a", "GET", "/too/many/parts")).status).toBe(404);
    const bad = await fetch(base + "/ft/mint", { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await fetch(base + "/ft/supply", { method: "DELETE" })).status).toBe(405);
  });
});

describe("CLI", () => {
  it("drives the model through terse commands", () => {
    const w = new Engine();
    expect(runLine(w, "admin ft.mint alice 1000")).toBe('{"ok":true}');
    expect(runLine(w, "alice ft.transfer bob 300")).toBe('{"ok":true}');
    expect(runLine(w, "x ft.balance bob")).toBe('{"balance":"300"}');
    expect(runLine(w, "admin nft.mint alice 1 ipfs://1 artist 500")).toBe('{"ok":true}');
    expect(runLine(w, "bob ft.approve market 200")).toBe('{"ok":true}');
    expect(runLine(w, "alice nft.approve market 1")).toBe('{"ok":true}');
    expect(runLine(w, "alice market.list 1 200")).toBe('{"ok":true}');
    expect(runLine(w, "bob market.buy 1")).toBe('{"fee":"5","royalty":"10","seller":"185"}');
    expect(runLine(w, "bob ft.transfer alice 99999")).toContain("InsufficientBalance");
    expect(runLine(w, "nonsense")).toContain("unknown command");
    expect(runLine(w, "")).toBe("");
    expect(runLine(w, "help")).toContain("market.buy");
  });
});
