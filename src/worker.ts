import type { Plugin } from "vite";
import { appBase, SERVER_ID, SERVER_READY } from "@huuma/ui/vite/adapter";

/**
 * The app as a Cloudflare Worker: the `main` the adapter gives
 * @cloudflare/vite-plugin, which wraps it in `dist/server/index.js`. Server
 * only, in dev too, where the plugin runs it in workerd.
 */
export const WORKER_ID = "virtual:huuma/worker";
const RESOLVED_WORKER_ID = `\0${WORKER_ID}`;

/**
 * A named export the Worker must have, e.g. a Durable Object class its
 * config binds, and the error without it.
 */
export interface ExportCheck {
  name: string;
  message: string;
}

/**
 * Serves `virtual:huuma/worker`. In dev, it fails with the message of each
 * of `checks()` whose export the app's server entry lacks.
 */
export function workerPlugin(checks: () => readonly ExportCheck[] = () => []): Plugin {
  return {
    name: "huuma:worker",
    resolveId: {
      filter: { id: new RegExp(`^${WORKER_ID}$`) },
      handler() {
        return RESOLVED_WORKER_ID;
      },
    },
    load: {
      filter: { id: new RegExp(`^\0${WORKER_ID}$`) },
      handler() {
        if (this.environment.config.consumer !== "server") {
          this.error(`${WORKER_ID} is the app as a Worker and is server only.`);
        }
        const config = this.environment.getTopLevelConfig();
        const dev = this.environment.mode === "dev";
        return {
          code: dev
            ? workerModule(appBase(config.base), config.base, checks())
            : workerModule(appBase(config.base)),
          moduleType: "js",
        };
      },
    },
  };
}

/**
 * Generates the source of `virtual:huuma/worker`: the app as the default
 * export, and the app's server entry's named exports, e.g. Durable Object
 * classes, which Cloudflare looks for in the Worker's main module.
 *
 * In dev, `viteBase` is Vite's `base`: the app's HTML gets Vite's client,
 * and the module tells the dev server once it's evaluated
 * (`SERVER_READY`). It throws first if the server entry lacks an export of
 * `checks`, which workerd would report as "Class extends value undefined".
 * The build checks the built Worker's exports instead (`exports.ts`).
 */
export function workerModule(
  base: string,
  viteBase?: string,
  checks: readonly ExportCheck[] = [],
): string {
  if (viteBase === undefined) {
    return [
      `import app from ${JSON.stringify(SERVER_ID)};`,
      'import { worker } from "@huuma/cloudflare/runtime";',
      "",
      `export * from ${JSON.stringify(SERVER_ID)};`,
      `export default worker(app, ${JSON.stringify(base)});`,
      "",
    ].join("\n");
  }
  return [
    `import app from ${JSON.stringify(SERVER_ID)};`,
    'import { withDevClient } from "@huuma/ui/vite/runtime";',
    'import { worker } from "@huuma/cloudflare/runtime";',
    "",
    ...(checks.length
      ? [
          `import * as server from ${JSON.stringify(SERVER_ID)};`,
          "",
          `const missing = ${JSON.stringify(checks.map(({ name, message }) => [name, message]))}`,
          '  .filter(([name]) => typeof server[name] !== "function")',
          "  .map(([, message]) => message);",
          'if (missing.length) throw new Error(missing.join("\\n"));',
          "",
        ]
      : []),
    `export * from ${JSON.stringify(SERVER_ID)};`,
    `export default worker(withDevClient(app, ${JSON.stringify(viteBase)}), ${JSON.stringify(base)});`,
    "",
    `import.meta.hot?.send(${JSON.stringify(SERVER_READY)});`,
    "",
  ].join("\n");
}
