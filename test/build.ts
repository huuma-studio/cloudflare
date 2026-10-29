// Builds copies of the basic fixture with the adapter, and runs them in
// workerd with `wrangler dev`.
import { createBuilder, type InlineConfig } from "vite";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { huuma } from "@huuma/ui/vite";

import { cloudflare } from "../src/mod.ts";

export const fixtures: string = fileURLToPath(new URL("fixtures", import.meta.url));

/** A port that's free right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * A page at `/image` that imports an image, too large for Vite to inline
 * (4 kB), so the server build emits it as a file: for `buildFixture()`'s
 * `files`.
 */
export const IMAGE_PAGE: Record<string, string> = {
  "app/image/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${"x".repeat(5_000)} --></svg>\n`,
  "app/image/page.tsx": [
    'import logo from "./logo.svg";',
    "",
    "export default function Image() {",
    '  return <img src={logo} alt="" />;',
    "}",
    "",
  ].join("\n"),
};

/**
 * The classes Cloudflare finds as named exports of the Worker, which
 * `server.ts` exports next to the app, for `buildFixture()`'s `files`: a
 * Durable Object, `ChatRoom`, a Workflow, `ImportRun`, and a named
 * entrypoint, `Greeter`. The app calls each through its binding:
 *
 * - `/chat` joins the room `lobby`, whose count of guests is in the
 *   object's storage: `ada #1`, `ada #2`, …
 * - `POST /import` starts a run for 3 rows and responds with its id;
 *   `/import/<id>` with its status, whose output is the rows doubled.
 * - `/greet` responds with `Greeter`'s `greet("ada")`.
 *
 * The Worker's config needs `WORKER_CLASSES_CONFIG`, with the Worker's
 * name `huuma-fixture`, which `GREETER` binds.
 */
export const WORKER_CLASSES: Record<string, string> = {
  "chat-room.ts": [
    'import { DurableObject } from "cloudflare:workers";',
    "",
    "export class ChatRoom extends DurableObject {",
    "  async join(name) {",
    '    const guests = ((await this.ctx.storage.get("guests")) ?? 0) + 1;',
    '    await this.ctx.storage.put("guests", guests);',
    "    return `${name} #${guests}`;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "import-run.ts": [
    'import { WorkflowEntrypoint } from "cloudflare:workers";',
    "",
    "export class ImportRun extends WorkflowEntrypoint {",
    "  async run(event, step) {",
    '    return await step.do("double", async () => event.payload.rows * 2);',
    "  }",
    "}",
    "",
  ].join("\n"),
  "greeter.ts": [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    "",
    "export class Greeter extends WorkerEntrypoint {",
    "  greet(name) {",
    "    return `Hello, ${name}`;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "server.ts": [
    'import { createUIApp } from "@huuma/ui/server";',
    'import Root from "./app/root.tsx";',
    "",
    "const app = createUIApp(Root);",
    "app.use(async (ctx, next) => {",
    "  const path = new URL(ctx.request.url).pathname;",
    '  if (path.endsWith("/chat")) {',
    '    const room = ctx.env.CHAT_ROOM.get(ctx.env.CHAT_ROOM.idFromName("lobby"));',
    '    return new Response(await room.join("ada"));',
    "  }",
    '  if (path.endsWith("/import") && ctx.request.method === "POST") {',
    "    const run = await ctx.env.IMPORT_RUN.create({ params: { rows: 3 } });",
    "    return Response.json({ id: run.id });",
    "  }",
    "  const id = /\\/import\\/([^/]+)$/.exec(path)?.[1];",
    "  if (id) return Response.json(await (await ctx.env.IMPORT_RUN.get(id)).status());",
    '  if (path.endsWith("/greet")) return new Response(await ctx.env.GREETER.greet("ada"));',
    "  return await next();",
    "});",
    "",
    'export { ChatRoom } from "./chat-room.ts";',
    'export { ImportRun } from "./import-run.ts";',
    'export { Greeter } from "./greeter.ts";',
    "export default app;",
    "",
  ].join("\n"),
};

/** The Worker's config for `WORKER_CLASSES`: their bindings and the migration. */
export const WORKER_CLASSES_CONFIG = {
  durable_objects: { bindings: [{ name: "CHAT_ROOM", class_name: "ChatRoom" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["ChatRoom"] }],
  workflows: [{ name: "import-run", binding: "IMPORT_RUN", class_name: "ImportRun" }],
  services: [{ binding: "GREETER", service: "huuma-fixture", entrypoint: "Greeter" }],
};

/**
 * Builds a copy of the basic fixture with `vite build`'s builder, with
 * `files` added to it first (contents by path). If the build fails, the
 * copy is removed.
 */
export async function buildFixture(
  prefix: string,
  config: InlineConfig = {},
  files: Record<string, string> = {},
): Promise<string> {
  const root = await mkdtemp(join(fixtures, prefix));
  await cp(join(fixtures, "basic"), root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  try {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [huuma({ adapter: cloudflare({ inspectorPort: false }) })],
      ...config,
    });
    await builder.buildApp();
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return root;
}

/**
 * Wrangler's CLI, which its package exports don't include, to run with
 * Node.
 */
export function wranglerCli(): string {
  return join(
    dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
}

/**
 * Runs the build in Cloudflare's workerd with `wrangler dev`, from the
 * `wrangler.json` the build wrote with @cloudflare/vite-plugin. Resolves
 * with its origin and a function that stops it.
 */
export async function startWorker(root: string): Promise<{ origin: string; stop: () => void }> {
  const [port, inspectorPort] = [await freePort(), await freePort()];
  const server = spawn(
    process.execPath,
    [
      wranglerCli(),
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: root },
      stdio: ["ignore", "pipe", "pipe"],
      // bin/wrangler.js starts the CLI as a child, which starts workerd:
      // killing only the first process leaves them running. On POSIX, its
      // own process group, to kill them all together. Windows has no
      // process groups, and a detached process would get its own console.
      detached: !windows,
      windowsHide: true,
    },
  );
  const stop = () => {
    if (windows) {
      // The process and its children (/T), or nothing if it already stopped.
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    try {
      process.kill(-server.pid!, "SIGKILL");
    } catch {
      // Already stopped.
    }
  };
  await started(server, "wrangler dev", "Ready on", stop);
  return { origin: `http://127.0.0.1:${port}`, stop };
}

const windows = process.platform === "win32";

// How long a server may take to start, below the tests' hook timeouts.
const START_TIMEOUT = 40_000;

// Resolves once `server` printed `ready`. Rejects if it exits first, or
// stops it and rejects if it doesn't start in time: the caller only gets
// the process once it started, so it couldn't stop it.
function started(
  server: ChildProcess,
  name: string,
  ready: string,
  stop: () => void = () => server.kill(),
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`${name} didn't start in ${START_TIMEOUT / 1000}s: ${output}`));
    }, START_TIMEOUT);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(ready)) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout!.on("data", read);
    server.stderr!.on("data", read);
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited (${code}): ${output}`));
    });
  });
}
