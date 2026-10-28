// Starts `vite dev` with the adapter on copies of the basic fixture.
import { huuma } from "@huuma/ui/vite";
import { createServer, type ViteDevServer } from "vite";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cloudflare } from "../src/mod.ts";
import { fixtures, freePort } from "./build.ts";

/**
 * Starts the dev server on a copy of the basic fixture, inside
 * test/fixtures so `@huuma/ui` and this package resolve from this repo's
 * node_modules; some tests edit it. The Worker has a KV namespace, local to
 * the dev server, and `wrangler`'s settings. `files` are added to the copy
 * (contents by path).
 */
export async function startDev(
  prefix: string,
  base = "/",
  { files = {}, wrangler = {} }: { files?: Record<string, string>; wrangler?: object } = {},
): Promise<{ root: string; server: ViteDevServer }> {
  const root = await mkdtemp(join(fixtures, prefix));
  await cp(join(fixtures, "basic"), root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(root, path), contents);
  }
  await writeFile(
    join(root, "wrangler.jsonc"),
    JSON.stringify({
      name: "huuma-fixture",
      compatibility_date: "2026-10-01",
      kv_namespaces: [{ binding: "KV", id: "huuma-fixture" }],
      ...wrangler,
    }),
  );
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root,
      base,
      configFile: false,
      logLevel: "silent",
      // Its own optimized deps, not the repo's node_modules/.vite, which
      // dev servers in other test files would change meanwhile.
      cacheDir: join(root, ".vite"),
      // A fixed port, which a restart keeps.
      server: { host: "127.0.0.1", port: await freePort(), strictPort: true },
      plugins: [huuma({ adapter: cloudflare({ inspectorPort: false }) })],
    });
    await server.listen();
  } catch (error) {
    // The copy is removed if the dev server doesn't start, also while
    // Miniflare still writes its state to it, without hiding the error.
    await server?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
    throw error;
  }
  return { root, server };
}
