// `vite dev` in workerd with a Durable Object that server.ts exports, or
// with one that it doesn't.
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { ViteDevServer } from "vite";
import { rm } from "node:fs/promises";

import { CHAT_ROOM, CHAT_ROOM_CONFIG } from "../test/build.ts";
import { startDev } from "../test/dev.ts";

// Starting workerd takes a few seconds.
const STARTUP = 60_000;

describe("vite dev in workerd with a Durable Object", () => {
  let root: string | undefined;
  let server: ViteDevServer | undefined;
  afterEach(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
    root = server = undefined;
  });

  test(
    "runs the Durable Object that server.ts exports",
    async () => {
      ({ root, server } = await startDev(".tmp-workerd-dev-do-", "/", {
        files: CHAT_ROOM,
        wrangler: CHAT_ROOM_CONFIG,
      }));
      const origin = new URL(server.resolvedUrls!.local[0]!).origin;
      expect(await (await fetch(`${origin}/chat`)).text()).toStrictEqual("ada #1");
      expect(await (await fetch(`${origin}/chat`)).text()).toStrictEqual("ada #2");
    },
    STARTUP,
  );

  test(
    "fails, naming the class, when server.ts doesn't export it",
    async () => {
      // Instead of workerd's "Class extends value undefined".
      await expect(
        startDev(".tmp-workerd-dev-missing-", "/", { wrangler: CHAT_ROOM_CONFIG }),
      ).rejects.toThrow(
        'wrangler.jsonc binds the Durable Object class "ChatRoom", but the Worker doesn\'t ' +
          'export it. Export it from server.ts, e.g. `export { ChatRoom } from "./chat-room.ts";`',
      );
    },
    STARTUP,
  );
});
