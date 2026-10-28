/*
 * The Cloudflare Workers adapter for Huuma UI (spec #143, D9 and D10): the
 * app runs as a Worker, in workerd during `vite` too, through
 * @cloudflare/vite-plugin, which this adapter creates.
 */
import { cloudflare as cloudflarePlugin, type PluginConfig } from "@cloudflare/vite-plugin";
import type { HuumaAdapter } from "@huuma/ui/vite/adapter";

import { basename } from "node:path";

import { type ClassesConfig, exportsCheckPlugin, missingExport, workerClasses } from "./exports.ts";
import { type ExportCheck, WORKER_ID, workerPlugin } from "./worker.ts";
import { cleanClientBuild, wranglerAssetsPlugin, writeClientFiles } from "./workers.ts";

/**
 * Options of @cloudflare/vite-plugin, which the adapter passes on, e.g.
 * `remoteBindings` or `configPath`. The plugin runs Vite's ssr
 * environment, where Huuma builds the app, so `viteEnvironment` is the
 * adapter's.
 */
export interface CloudflareOptions extends Omit<PluginConfig, "viteEnvironment"> {}

/**
 * The adapter for Cloudflare Workers:
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { huuma } from "@huuma/ui/vite";
 * import { cloudflare } from "@huuma/cloudflare";
 *
 * export default defineConfig({ plugins: [huuma({ adapter: cloudflare() })] });
 * ```
 *
 * The Worker is the app (`virtual:huuma/worker`), so `wrangler.jsonc`
 * needs no `main`. `vite` runs it in workerd, with the Worker's bindings,
 * and `vite build` writes it with the `wrangler.json` that `wrangler
 * deploy` deploys. It exports the named exports of the app's `server.ts`
 * too, e.g. Durable Object classes; without a class the config binds,
 * dev and the build fail and name it.
 */
export function cloudflare(options: CloudflareOptions = {}): HuumaAdapter {
  // The Worker's `main`, and the classes it must export while it's
  // Huuma's, for dev.
  let main: string | undefined;
  let checks: ExportCheck[] = [];
  return {
    name: "cloudflare",
    dev: "platform",
    plugins: [
      cloudflarePlugin({
        ...options,
        viteEnvironment: { name: "ssr" },
        config: withMain(options.config, (config) => {
          main = config.main;
          checks = config.main === WORKER_ID ? exportChecks(config) : [];
        }),
      }),
      workerPlugin(() => checks),
      exportsCheckPlugin(() => main),
      wranglerAssetsPlugin(),
    ],
    beforeBuild: cleanClientBuild,
    afterBuild: writeClientFiles,
  };
}

/**
 * The app's Worker config, with Huuma's Worker as `main` unless
 * `wrangler.jsonc` or the `config` option names another, e.g. a Worker of
 * the app's that wraps it. `resolved` gets the config with both.
 */
function withMain(
  config: CloudflareOptions["config"],
  resolved: (config: ClassesConfig & { main?: string }) => void,
): NonNullable<PluginConfig["config"]> {
  return (worker) => {
    const own = typeof config === "function" ? config(worker) : config;
    const overrides = { ...(worker.main ? {} : { main: WORKER_ID }), ...own };
    resolved({ ...worker, ...overrides } as ClassesConfig & { main?: string });
    return overrides;
  };
}

// What the Worker of `config` must export, for dev, where the app's
// server entry is `server.ts` unless Huuma's `server` option names another.
function exportChecks(config: ClassesConfig & { userConfigPath?: string }): ExportCheck[] {
  const configFile = basename(config.userConfigPath ?? "wrangler.jsonc");
  return workerClasses(config).map((workerClass) => ({
    name: workerClass.name,
    message: missingExport(workerClass, configFile, "server.ts"),
  }));
}
