import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Engine } from "./engine";
import { Args } from "./world";

const UI_PATH = fileURLToPath(new URL("./ui.html", import.meta.url));

/**
 * REST facade. `GET /` serves the single-page web UI. Routes are `POST|GET /<group>/<action>` -> action "<group>.<action>".
 * The caller is taken from the `x-caller` header (this is a model, not real auth).
 * GET requests read their arguments from the query string, POST from a JSON body.
 */
export function createServer(engine = new Engine()): http.Server {
  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 0 && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return void res.end(readFileSync(UI_PATH));
      }
      if (parts.length !== 2) return send(404, { error: "UnknownRoute" });

      let args: Args = Object.fromEntries(url.searchParams);
      if (req.method === "POST") {
        const raw = await new Promise<string>((done) => {
          let s = "";
          req.on("data", (c) => (s += c));
          req.on("end", () => done(s));
        });
        try {
          args = raw ? (JSON.parse(raw) as Args) : {};
        } catch {
          return send(400, { error: "BadJson" });
        }
      } else if (req.method !== "GET") {
        return send(405, { error: "MethodNotAllowed" });
      }

      const caller = String(req.headers["x-caller"] ?? "");
      const r = engine.run(caller, `${parts[0]}.${parts[1]}`, args);
      send(r.status, r.body);
    } catch (e) {
      send(500, { error: "Internal", message: String(e) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env["PORT"] ?? 3000);
  createServer(new Engine(process.env["DB_PATH"])).listen(port, () => console.log(`model_app listening on http://localhost:${port}`));
}
