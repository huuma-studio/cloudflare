/*
 * Cloudflare finds a Worker's Durable Object and Workflow classes as named
 * exports of its main module. Huuma's Worker re-exports the app's server
 * entry, so apps export them from `server.ts`. Without one, the Worker
 * fails when it starts, with "Class extends value undefined": these
 * checks name the class instead, in the build and in dev.
 */
import type { Plugin } from "vite";
import { SERVER_ID } from "@huuma/ui/vite/adapter";
import { basename, relative, resolve } from "node:path";

import { WORKER_ID } from "./worker.ts";

/** A class the Worker's config binds, which the Worker must export. */
export interface WorkerClass {
  kind: "Durable Object" | "Workflow";
  name: string;
}

/** What of the Worker's config names its classes. */
export interface ClassesConfig {
  name?: string;
  durable_objects?: { bindings?: readonly ClassBinding[] };
  workflows?: readonly ClassBinding[];
}

interface ClassBinding {
  class_name: string;
  /** Another Worker's, which exports the class. */
  script_name?: string;
}

/**
 * The classes the Worker's config binds that the Worker exports itself:
 * those of `durable_objects.bindings` and `workflows` without another
 * Worker's `script_name`, each once.
 */
export function workerClasses(config: ClassesConfig): WorkerClass[] {
  const own = (binding: ClassBinding) =>
    !binding.script_name || binding.script_name === config.name;
  const classes = new Map<string, WorkerClass>();
  const add = (kind: WorkerClass["kind"], bindings: readonly ClassBinding[] = []) => {
    for (const binding of bindings.filter(own)) {
      if (!classes.has(binding.class_name)) {
        classes.set(binding.class_name, { kind, name: binding.class_name });
      }
    }
  };
  add("Durable Object", config.durable_objects?.bindings);
  add("Workflow", config.workflows);
  return [...classes.values()];
}

/**
 * The error for a class the Worker doesn't export: `configFile` binds it,
 * and it belongs in `module`, e.g. `server.ts`.
 */
export function missingExport(
  workerClass: WorkerClass,
  configFile: string,
  module: string,
): string {
  // `./chat-room.ts` for `ChatRoom`, `./sso-import.ts` for `SSOImport`.
  const file = workerClass.name
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return (
    `${configFile} binds the ${workerClass.kind} class "${workerClass.name}", but the Worker ` +
    `doesn't export it. Export it from ${module}, e.g. ` +
    `\`export { ${workerClass.name} } from "./${file}.ts";\``
  );
}

/**
 * Fails the build when the Worker doesn't export a class its config binds
 * (`workerClasses()`), from the `wrangler.json` that @cloudflare/vite-plugin
 * writes and the exports of the `main` it names. `main()` is the Worker's
 * `main` before the build: Huuma's Worker, whose exports are the app's
 * server entry's, or the app's own, which the error names instead.
 */
export function exportsCheckPlugin(main: () => string | undefined): Plugin {
  return {
    name: "huuma:worker-exports",
    apply: "build",
    generateBundle: {
      // After the Cloudflare plugin emitted `wrangler.json`.
      order: "post",
      handler(_, bundle) {
        const file = bundle["wrangler.json"];
        if (this.environment.config.consumer !== "server" || file?.type !== "asset") return;
        const config = JSON.parse(String(file.source)) as ClassesConfig & {
          main?: string;
          userConfigPath?: string;
        };
        const chunk = config.main ? bundle[config.main] : undefined;
        if (chunk?.type !== "chunk") return;
        const exported = new Set(chunk.exports);
        const missing = workerClasses(config).filter(({ name }) => !exported.has(name));
        if (!missing.length) return;

        const root = this.environment.getTopLevelConfig().root;
        const own = main();
        // The app's server entry for Huuma's Worker, which re-exports it.
        const module =
          own === undefined || own === WORKER_ID
            ? this.getModuleInfo(`\0${SERVER_ID}`)?.importedIds[0]
            : resolve(root, own);
        const configFile = basename(config.userConfigPath ?? "wrangler.jsonc");
        this.error(
          missing
            .map((workerClass) =>
              missingExport(
                workerClass,
                configFile,
                module ? relative(root, module).replaceAll("\\", "/") : "server.ts",
              ),
            )
            .join("\n"),
        );
      },
    },
  };
}
