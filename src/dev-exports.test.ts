// `vite dev` in workerd with the Durable Object, Workflow and named
// entrypoint that server.ts exports, or with classes that it doesn't.
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { ViteDevServer } from "vite";
import { rm } from "node:fs/promises";

import { WORKER_CLASSES, WORKER_CLASSES_CONFIG } from "../test/build.ts";
import { startDev } from "../test/dev.ts";

// Starting workerd takes a few seconds.
const STARTUP = 60_000;

describe("vite dev in workerd with classes of the Worker", () => {
  let root: string | undefined;
  let server: ViteDevServer | undefined;
  afterEach(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
    root = server = undefined;
  });

  test(
    "runs the Durable Object, Workflow and named entrypoint that server.ts exports",
    async () => {
      ({ root, server } = await startDev(".tmp-workerd-dev-do-", "/", {
        files: WORKER_CLASSES,
        wrangler: WORKER_CLASSES_CONFIG,
      }));
      const origin = new URL(server.resolvedUrls!.local[0]!).origin;
      expect(await (await fetch(`${origin}/chat`)).text()).toStrictEqual("ada #1");
      expect(await (await fetch(`${origin}/chat`)).text()).toStrictEqual("ada #2");
      const { id } = (await (await fetch(`${origin}/import`, { method: "POST" })).json()) as {
        id: string;
      };
      await vi.waitFor(
        async () =>
          expect(await (await fetch(`${origin}/import/${id}`)).json()).toMatchObject({
            status: "complete",
            output: 6,
          }),
        { timeout: 10_000 },
      );
      expect(await (await fetch(`${origin}/greet`)).text()).toStrictEqual("Hello, ada");
    },
    STARTUP,
  );

  test(
    "fails, naming each class, when server.ts doesn't export them",
    async () => {
      // Instead of workerd's "Class extends value undefined".
      await expect(
        startDev(".tmp-workerd-dev-missing-", "/", { wrangler: WORKER_CLASSES_CONFIG }),
      ).rejects.toThrow(
        'wrangler.jsonc binds the Durable Object class "ChatRoom", but the Worker doesn\'t ' +
          'export it. Export it from server.ts, e.g. `export { ChatRoom } from "./chat-room.ts";`\n' +
          'wrangler.jsonc binds the Workflow class "ImportRun", but the Worker doesn\'t export ' +
          'it. Export it from server.ts, e.g. `export { ImportRun } from "./import-run.ts";`\n' +
          'wrangler.jsonc binds the WorkerEntrypoint class "Greeter", but the Worker doesn\'t ' +
          'export it. Export it from server.ts, e.g. `export { Greeter } from "./greeter.ts";`',
      );
    },
    STARTUP,
  );
});
