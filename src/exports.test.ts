import { describe, expect, test } from "vite-plus/test";

import { missingExport, workerClasses } from "./exports.ts";

describe(workerClasses.name, () => {
  test("lists the Durable Object and Workflow classes of the Worker's own bindings", () => {
    expect(
      workerClasses({
        name: "shop",
        durable_objects: {
          bindings: [
            { class_name: "ChatRoom" },
            // The same class, bound twice.
            { class_name: "ChatRoom" },
            { class_name: "Cart", script_name: "shop" },
            // Another Worker's, which exports it.
            { class_name: "Billing", script_name: "billing" },
          ],
        },
        workflows: [{ class_name: "ImportRun" }, { class_name: "Invoice", script_name: "billing" }],
      }),
    ).toStrictEqual([
      { kind: "Durable Object", name: "ChatRoom" },
      { kind: "Durable Object", name: "Cart" },
      { kind: "Workflow", name: "ImportRun" },
    ]);
  });

  test("lists the named entrypoints that bind the Worker itself", () => {
    expect(
      workerClasses({
        name: "shop",
        services: [
          { service: "shop", entrypoint: "Greeter" },
          // The Worker's default export, and another Worker's entrypoint.
          { service: "shop" },
          { service: "auth", entrypoint: "Auth" },
        ],
      }),
    ).toStrictEqual([{ kind: "WorkerEntrypoint", name: "Greeter" }]);
  });

  test("is empty without classes", () => {
    expect(workerClasses({ name: "shop" })).toStrictEqual([]);
    expect(workerClasses({ durable_objects: {}, workflows: [] })).toStrictEqual([]);
  });
});

describe(missingExport.name, () => {
  test("names the class, the config and the module to export it from", () => {
    expect(
      missingExport({ kind: "Durable Object", name: "ChatRoom" }, "wrangler.jsonc", "server.ts"),
    ).toStrictEqual(
      'wrangler.jsonc binds the Durable Object class "ChatRoom", but the Worker doesn\'t ' +
        'export it. Export it from server.ts, e.g. `export { ChatRoom } from "./chat-room.ts";`',
    );
    expect(
      missingExport({ kind: "Workflow", name: "SSOImport2" }, "wrangler.toml", "src/server.ts"),
    ).toContain('`export { SSOImport2 } from "./sso-import2.ts";`');
  });
});
