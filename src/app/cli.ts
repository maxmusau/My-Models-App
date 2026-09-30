import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { Engine } from "./engine";
import { actions } from "./world";

/** Positional argument names for each command, so the REPL stays terse. */
const SIGNATURES: Record<string, string[]> = {
  "ft.mint": ["to", "amount"],
  "ft.burn": ["amount"],
  "ft.transfer": ["to", "amount"],
  "ft.approve": ["spender", "amount"],
  "ft.transferFrom": ["from", "to", "amount"],
  "ft.balance": ["address"],
  "ft.supply": [],
  "nft.mint": ["to", "id", "uri", "royaltyReceiver", "royaltyBps"],
  "nft.burn": ["id"],
  "nft.transfer": ["from", "to", "id"],
  "nft.approve": ["spender", "id"],
  "nft.approveAll": ["operator", "approved"],
  "nft.get": ["id"],
  "nft.owned": ["address"],
  "market.list": ["id", "price"],
  "market.cancel": ["id"],
  "market.buy": ["id"],
  "market.listings": [],
  "market.createAuction": ["id", "reserve", "duration"],
  "market.bid": ["id", "amount"],
  "market.settle": ["id"],
  "market.cancelAuction": ["id"],
  "market.auctions": [],
  "time.advance": ["seconds"],
  "state.snapshot": [],
};

const HELP = `Usage:  <caller> <command> [args...]      e.g.  admin ft.mint alice 1000
Commands:
${Object.entries(SIGNATURES)
  .map(([k, v]) => `  ${k} ${v.map((x) => `<${x}>`).join(" ")}`)
  .join("\n")}
Special: help, exit. Use "-" to skip an optional argument.
Built-in names: "admin" (minter), "market" (marketplace operator), "treasury" (fee receiver).`;

/** Execute one REPL line against a world and return the text to print. */
export function runLine(w: Engine, line: string): string {
  const t = line.trim().split(/\s+/);
  if (t[0] === "" || t[0] === undefined) return "";
  if (t[0] === "help") return HELP;
  const [caller, cmd, ...rest] = t;
  if (!cmd || !(cmd in actions)) return 'error: unknown command. Type "help".';

  const args: Record<string, unknown> = {};
  (SIGNATURES[cmd] ?? []).forEach((name, i) => {
    const v = rest[i];
    if (v !== undefined && v !== "-") args[name] = v;
  });
  if (cmd === "nft.mint" && args["royaltyReceiver"] !== undefined) {
    args["royalty"] = { receiver: args["royaltyReceiver"], bps: Number(args["royaltyBps"]) };
  }
  if (cmd === "nft.approveAll") args["approved"] = args["approved"] !== "false";

  const r = w.run(caller!, cmd, args);
  return r.status === 200 ? JSON.stringify(r.body) : `error ${r.status}: ${JSON.stringify(r.body)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const w = new Engine(process.env["DB_PATH"]);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  console.log(HELP);
  rl.prompt();
  rl.on("line", (line) => {
    if (line.trim() === "exit") return rl.close();
    const out = runLine(w, line);
    if (out) console.log(out);
    rl.prompt();
  });
}
