import { DatabaseSync } from "node:sqlite";
import { Args, execute, READ_ONLY, Result, World } from "./world";

/** One recorded, successful, state-changing action. */
export interface LogRow {
  seq: number;
  at: number;
  caller: string;
  name: string;
  args: Args;
}

/** Append-only action log in SQLite. */
export class ActionLog {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS actions (
      seq    INTEGER PRIMARY KEY AUTOINCREMENT,
      at     INTEGER NOT NULL,
      caller TEXT NOT NULL,
      name   TEXT NOT NULL,
      args   TEXT NOT NULL
    )`);
  }

  append(at: number, caller: string, name: string, args: Args): void {
    this.db
      .prepare("INSERT INTO actions (at, caller, name, args) VALUES (?, ?, ?, ?)")
      .run(at, caller, name, JSON.stringify(args));
  }

  all(): LogRow[] {
    const rows = this.db.prepare("SELECT seq, at, caller, name, args FROM actions ORDER BY seq").all();
    return rows.map((r) => ({
      seq: Number(r["seq"]),
      at: Number(r["at"]),
      caller: String(r["caller"]),
      name: String(r["name"]),
      args: JSON.parse(String(r["args"])) as Args,
    }));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * The thing the REST server and CLI talk to: a World plus optional persistence.
 *
 * Persistence is event sourcing. Only successful state-changing actions are stored, and opening an
 * existing database rebuilds the world by replaying them in order with their original timestamps.
 * A failed action provably changes nothing (see the invariant tests), so replaying only the
 * successes reproduces exactly the same state.
 */
export class Engine {
  readonly world: World;
  private log: ActionLog | null;

  /** @param dbPath SQLite file path, ":memory:", or undefined for no persistence. */
  constructor(dbPath?: string, feeBps = 250) {
    this.world = new World(feeBps);
    this.log = dbPath ? new ActionLog(dbPath) : null;
    if (this.log) {
      try {
        this.replay(this.log.all());
      } catch (e) {
        this.log.close(); // don't leak the file handle when refusing to start
        throw e;
      }
    }
  }

  run(caller: string, name: string, args: Args = {}): Result {
    const at = this.world.clock.now();
    const r = execute(this.world, caller, name, args);
    if (r.status === 200 && this.log && !READ_ONLY.has(name)) {
      this.log.append(at, caller, name, args);
    }
    return r;
  }

  close(): void {
    this.log?.close();
  }

  private replay(rows: LogRow[]): void {
    const clock = this.world.clock;
    let advanced = 0;
    for (const row of rows) {
      clock.set(row.at);
      const r = execute(this.world, row.caller, row.name, row.args);
      if (r.status !== 200) {
        throw new Error(
          `corrupt log: action #${row.seq} (${row.name}) no longer succeeds: ${JSON.stringify(r.body)}`,
        );
      }
      if (row.name === "time.advance") advanced += Number(row.args["seconds"]);
    }
    // Back to live time, keeping any demo time travel that had been applied.
    clock.release();
    clock.advance(advanced);
  }
}
