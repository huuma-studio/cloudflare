import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { createServer, type RunnableDevEnvironment, type ViteDevServer } from "vite";
import { huuma } from "@huuma/ui/vite";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtures } from "../test/build.ts";

import { WORKER_ID, workerModule, workerPlugin } from "./worker.ts";

const fixture = fileURLToPath(new URL("../test/fixtures/basic", import.meta.url));

interface Worker {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
}

describe("the Worker entry in dev", () => {
  // Without @cloudflare/vite-plugin: Vite's own module runner imports the
  // entry, as the plugin's does in workerd.
  let server: ViteDevServer;
  let worker: Worker;
  beforeAll(async () => {
    server = await createServer({
      root: fixture,
      base: "/shop/",
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      plugins: [huuma({ adapter: { name: "test", plugins: [workerPlugin()] } })],
    });
    const ssr = server.environments.ssr as RunnableDevEnvironment;
    ({ default: worker } = (await ssr.runner.import(WORKER_ID)) as { default: Worker });
  });
  afterAll(async () => {
    await server.close();
  });

  test("serves the app below the base, from the full URL a platform passes", async () => {
    const response = await worker.fetch(new Request("http://localhost/shop/about"), {}, {});
    expect(response.status).toStrictEqual(200);
    const html = await response.text();
    expect(html).toContain("<h1>About</h1>");
    // With Vite's client, which Huuma's Node middleware adds otherwise.
    expect(html).toMatch(
      /<script type="module" src="\/shop\/@vite\/client" nonce="[^"]+"><\/script>/,
    );
  });
});

describe("the Worker entry in dev, without an export the Worker's config needs", () => {
  // A copy of the basic fixture whose server entry is `entry.ts`, named by
  // Huuma's `server` option.
  let root: string;
  let server: ViteDevServer;
  beforeAll(async () => {
    root = await mkdtemp(join(fixtures, ".tmp-worker-checks-"));
    await cp(fixture, root, { recursive: true });
    await rename(join(root, "server.ts"), join(root, "entry.ts"));
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      plugins: [
        huuma({
          server: "entry.ts",
          adapter: {
            name: "test",
            plugins: [
              workerPlugin(() => [
                { name: "ChatRoom", message: (entry) => `Export ChatRoom from ${entry}.` },
                { name: "ImportRun", message: (entry) => `Export ImportRun from ${entry}.` },
              ]),
            ],
          },
        }),
      ],
    });
  });
  afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  test("fails with the message of each export the app's server entry lacks, naming it", async () => {
    const ssr = server.environments.ssr as RunnableDevEnvironment;
    await expect(ssr.runner.import(WORKER_ID)).rejects.toThrow(
      new Error("Export ChatRoom from entry.ts.\nExport ImportRun from entry.ts."),
    );
  });
});

describe(workerModule.name, () => {
  test("is the app as a Worker in the build", () => {
    const code = workerModule("/shop/");
    expect(code).toContain('export default worker(app, "/shop/");');
    // With the app's named exports, e.g. Durable Object classes.
    expect(code).toContain('export * from "virtual:huuma/server";');
    expect(code).not.toContain("withDevClient");
    expect(code).not.toContain("import.meta.hot");
  });

  test("adds Vite's client and tells the dev server once it's evaluated, in dev", () => {
    const code = workerModule("/shop/", "/shop/");
    expect(code).toContain('export default worker(withDevClient(app, "/shop/"), "/shop/");');
    expect(code).toContain('import.meta.hot?.send("huuma:server-ready");');
    expect(code).toContain('export * from "virtual:huuma/server";');
    expect(code).not.toContain("throw");
  });

  test("checks the exports the Worker's config needs in dev, not in the build", () => {
    const code = workerModule("/", "/", [{ name: "ChatRoom", message: "Export ChatRoom." }]);
    expect(code).toContain('import * as server from "virtual:huuma/server";');
    expect(code).toContain('throw new Error(missing.join("\\n"));');
    expect(code.indexOf("throw")).toBeLessThan(code.indexOf("import.meta.hot"));
    expect(workerModule("/")).not.toContain("throw");
  });
});
