# model_app

A working, fully tested model of a digital-asset marketplace. It covers **fungible tokens** (interchangeable units,
like a currency), **non-fungible tokens** (unique items, like a piece of art) and a **marketplace** where the unique
items are bought and sold for the currency, at a fixed price or by auction, with platform fees and creator royalties.

I built it so you can try the business rules for real, click through them, and see the evidence that they behave
correctly, before committing to a production build. This document explains what is in the box, how to run it, and
where its limits are.

## What you get

| | |
|---|---|
| **A working rule engine** | Minting, transferring, approving and burning both token types, plus listings, auctions, fees and royalties |
| **A web app** | One page where you can act as different users and watch balances, items, listings and auctions update |
| **A REST API** | The same actions over HTTP, for connecting your own front end or systems |
| **A command-line tool** | A quick way to script or explore the rules |
| **Saved state (optional)** | Turn on a database and everything survives a restart |
| **Smart-contract versions** | Solidity contracts for the tokens and the fixed-price marketplace, checked against the rule engine |
| **An automated test suite** | 93 tests that prove the rules hold, including randomized tests that try to break them |

## See it in 2 minutes

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install
npm run serve
```

Open <http://localhost:3000> and press **Load demo**. That creates some users and funds, mints an artwork with a 5%
creator royalty, and starts an auction that two people bid on. Then press **+1 hour** to move the clock forward, go to
the **Auction** tab in "Do something" and run **Settle**. The winner receives the artwork, and the payment is split
between the seller, the creator and the platform.

In the page you can:
- pick who you are acting as (`admin`, `alice`, `bob`, `carol`, … or type any name),
- run any action from the forms (mint, transfer, approve, list, buy, auction, bid, settle),
- read the activity log to see exactly what worked and what was refused, and why.

## How it works

### The three building blocks

**Currency (fungible tokens).** A ledger of balances. Only the `admin` can create new units. Nobody can go below zero,
and the total supply always equals the sum of everyone's balances.

**Unique items (non-fungible tokens).** Each item has one ID, one owner and optional details (a link and a creator
royalty). An item can be moved by its owner, or by someone the owner has approved. Moving an item cancels any
single-item approval on it.

**Marketplace.** Sells unique items for the currency. Fees and royalties are worked out in whole units, and the parts
always add up to the exact price, with no money lost to rounding.

### Selling at a fixed price

1. The seller approves the marketplace to handle the item, then **lists** it with a price.
2. The buyer allows the marketplace to spend that amount of their currency, then **buys**.
3. In one step, the item moves to the buyer and the money is split three ways.

Example: a sale of 1000 with a 2.5% platform fee and a 5% creator royalty pays **25** to the platform, **50** to the
creator and **925** to the seller.

A purchase either completes fully or changes nothing. A listing is ignored if the seller no longer owns the item or
has withdrawn the approval.

### Selling by auction

1. The seller approves the marketplace, then **starts an auction** with a reserve price and a duration.
2. Bidders **bid**. Each bid must meet the reserve and beat the current highest bid. The bid amount is held safely by
   the marketplace, and the previous highest bidder is refunded immediately.
3. After the end time, anyone can **settle**. The item goes to the winner and the money is split like a normal sale.
4. The seller can cancel only before the first bid.

If the seller moves the item away mid-auction, settling refunds the highest bidder instead of failing, so money can
never get stuck.

### Rules at a glance

- Only the admin can create currency or items.
- Platform fee and creator royalty are each capped at 10%.
- A seller can't buy their own listing or bid on their own auction.
- An item can't be listed and auctioned at the same time.
- The marketplace's held bids always equal the sum of all open highest bids.

## Connecting to it

### REST API

The same server that hosts the web page also exposes the API on the same port (set `PORT` to change it).

- Routes look like `/<group>/<action>`. The groups are `ft`, `nft`, `market`, `time` and `state`.
- Identify the user with the `x-caller` header.
- Amounts and prices are sent as **strings**, so very large numbers stay exact.
- `POST` takes a JSON body. `GET` takes query parameters.

| Route | What it does |
|---|---|
| `POST /ft/mint` `{to, amount}` | Create currency (admin only) |
| `POST /ft/transfer` `{to, amount}` | Send currency |
| `POST /ft/approve` `{spender, amount}` | Allow someone (e.g. `market`) to spend up to an amount |
| `POST /ft/burn` `{amount}` · `POST /ft/transferFrom` `{from, to, amount}` | Destroy currency · spend an allowance |
| `GET /ft/balance?address=` · `GET /ft/supply` | Read a balance · total supply |
| `POST /nft/mint` `{to, id, uri?, royalty?: {receiver, bps}}` | Create an item (admin only). `bps` is hundredths of a percent, so 500 = 5% |
| `POST /nft/transfer` `{from, to, id}` · `POST /nft/burn` `{id}` | Move or destroy an item |
| `POST /nft/approve` `{spender, id}` · `POST /nft/approveAll` `{operator, approved}` | Allow someone to handle one item, or all of yours |
| `GET /nft/get?id=` · `GET /nft/owned?address=` | Read an item · list a person's items |
| `POST /market/list` `{id, price}` · `POST /market/cancel` `{id}` | Put an item up for sale · withdraw it |
| `POST /market/buy` `{id}` | Buy a listed item |
| `GET /market/listings` | All live listings |
| `POST /market/createAuction` `{id, reserve, duration}` | Start an auction (duration in seconds) |
| `POST /market/bid` `{id, amount}` | Place a bid |
| `POST /market/settle` `{id}` | Close an ended auction (anyone can) |
| `POST /market/cancelAuction` `{id}` | Cancel an auction that has no bids |
| `GET /market/auctions` | All live auctions |
| `POST /time/advance` `{seconds}` | Move the clock forward. **For demos and testing only; admin only** |
| `GET /state/snapshot` | The whole picture in one call (this is what the web page uses) |

Example:

```bash
curl -X POST localhost:3000/ft/mint -H "x-caller: admin" -d '{"to":"bob","amount":"5000"}'
```

Responses: `200` success, `403` not allowed, `404` not found, `409` already exists / listed / in an auction, `400`
anything else (bad input, not enough funds, and so on). Errors are explained, for example
`{"error":"InsufficientBalance"}`.

### Command line

```bash
npm run cli
```

Type one command per line as `<user> <command> [details]`, for example `admin ft.mint alice 1000`. Type `help` for the
full list.

### Keeping data between restarts

By default the app starts empty every time. To keep everything, point it at a database file:

```bash
DB_PATH=world.db npm run serve          # Windows PowerShell:  $env:DB_PATH="world.db"; npm run serve
```

Every successful action is recorded, and on start-up the app replays the record to restore exactly where it left off.
If a saved record can no longer be replayed (for example after a rule change), the app refuses to start rather than
show wrong numbers.

## Why you can trust the results

Everything is verified by automated tests. Run them yourself:

```bash
npm test              # 60 tests on the rule engine, API, web server, saved state
npm run test:sol      # 33 tests on the smart contracts (needs Docker)
npm run test:all      # both
```

What the tests cover:

- **Every rule, including the failures.** Not just "it works", but "it refuses the wrong thing, and nothing changes
  when it does".
- **Randomized stress tests.** Thousands of random sequences of valid and invalid actions are fired at the system
  after every step, checking that the important truths still hold (supply adds up, every item has exactly one owner,
  money is conserved, held bids match).
- **Real bugs found and fixed along the way.** For example, a zero-amount spend with no approval used to crash the
  ledger, and a corrupted save file used to leave the database locked. Both are fixed and locked in by tests.
- **Rule engine vs smart contracts.** 120 random scenarios (9,600 steps) are run through the rule engine, recorded,
  and then replayed against the real Solidity contracts. Every step must succeed or be refused exactly as the rule
  engine did, and the final state must match. I checked that this test genuinely catches errors by deliberately
  breaking the contracts: both breakages were caught.

## Smart contracts

The `solidity/` folder holds contracts for the currency, the unique items (with royalties) and the fixed-price
marketplace, written to follow the rule engine exactly. They are tested with [Foundry](https://book.getfoundry.sh/)
(unit tests, fuzz tests, stateful invariant tests and the comparison above). `npm run test:sol` runs them inside
Docker, so you don't need to install anything else.

## What's included vs what's next

**Honest boundaries of this version:**

- **It is a model, not a live product.** There is no connection to a blockchain, and no real payments.
- **No real login.** The app trusts whoever the caller says they are. A production version would use signed requests
  or accounts.
- **Auctions exist in the rule engine, API and web page, but not yet in the smart contracts.** The contracts cover the
  currency, items and fixed-price sales.
- **The smart contracts are intentionally small and have not been security-audited.** Before any real deployment they
  should be built on audited libraries and independently reviewed. The tests here are designed to serve as the
  specification for that work.
- **Saved state is a simple replay log.** It is exact and easy to reason about; very long histories would want
  periodic snapshots for faster start-up.

**Natural next steps** (scoped separately if you'd like them):

1. Auctions in the smart contracts, with the same side-by-side verification.
2. Offers on items that aren't listed, and anti-sniping protection for auctions.
3. Real authentication and user accounts.
4. Deployment to a test network, then a production network after an audit.

## For developers

<details>
<summary>Project layout and technical notes</summary>

```
src/
  core/               the rule engine (no I/O): ledger.ts, nftRegistry.ts, marketplace.ts, clock.ts, errors.ts
  app/
    world.ts          actions shared by the API, web page and CLI
    engine.ts         runs actions; optional SQLite action log and replay
    server.ts         REST server (plain node:http) that also serves the web page
    ui.html           the single-page web UI (no build step)
    cli.ts            interactive command line
  differential.ts     scenario generator used to compare the engine with the contracts
scripts/gen-differential.ts   writes the shared comparison scenarios
tests/                Vitest and fast-check
solidity/
  src/                Token.sol, Collection.sol, Marketplace.sol
  test/               Foundry unit, fuzz, invariant and differential tests
  test/fixtures/      scenarios.json (generated, committed)
```

- **Stack:** TypeScript (strict), Node 22.13+ with built-in SQLite, Vitest, fast-check, Foundry.
- **Amounts** are `bigint` throughout, and strings over the wire.
- **The rule engine is the specification.** After changing a rule, run `npm run diff:gen` to regenerate the
  comparison scenarios and commit the result. A test fails until you do, so the engine and contracts can't drift apart.
- **The comparison** checks success versus failure and the final state (not which error was raised), in a small world
  (7 addresses, 4 item IDs) so that interesting collisions are frequent.
- **Buyers pay through an allowance**, exactly as they must on a blockchain, so the rule engine works the same way.
- **Stale listings:** a listing made invalid (item moved, approval withdrawn) is ignored, but can come back at its old
  price if the seller regains the item and re-approves the marketplace.

</details>
