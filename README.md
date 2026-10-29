# @huuma/cloudflare

The Cloudflare Workers adapter for [Huuma UI](https://jsr.io/@huuma/ui): the app runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/), in workerd during `vite` too, with the Worker's bindings. The adapter brings [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/).

```sh
pnpm add -D jsr:@huuma/cloudflare
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { huuma } from "@huuma/ui/vite";
import { cloudflare } from "@huuma/cloudflare";

export default defineConfig({ plugins: [huuma({ adapter: cloudflare() })] });
```

```jsonc
// wrangler.jsonc: no `main` or `assets`
{
  "name": "my-app",
  "compatibility_date": "2026-10-01",
}
```

```sh
vite                  # dev, in workerd
vite build            # dist/server/index.js and dist/server/wrangler.json
npx wrangler deploy
```

## Durable Objects, Workflows and named entrypoints

Cloudflare finds Durable Object and Workflow classes and named `WorkerEntrypoint`s as named exports of the Worker. Export them from `server.ts`, next to the app: the adapter's Worker exports them, in dev and in the build, and its default export stays the app.

```ts
// server.ts
import { createUIApp } from "@huuma/ui/server";
import Root from "./app/root.tsx";

const app = createUIApp(Root);

// Durable Objects
export { ChatRoom } from "./src/chat-room.ts";
// Workflows
export { ImportRun } from "./src/import-run.ts";
// Named entrypoints (`WorkerEntrypoint` classes)
export { Greeter } from "./src/greeter.ts";

export default app;
```

```jsonc
// wrangler.jsonc: still no `main`
{
  "name": "my-app",
  "compatibility_date": "2026-10-01",
  "durable_objects": { "bindings": [{ "name": "CHAT_ROOM", "class_name": "ChatRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatRoom"] }],
  "workflows": [{ "name": "import-run", "binding": "IMPORT_RUN", "class_name": "ImportRun" }],
  "services": [{ "binding": "GREETER", "service": "my-app", "entrypoint": "Greeter" }],
}
```

Server code reaches them through the bindings, e.g. `requestContext().env.CHAT_ROOM`.

If `wrangler.jsonc` binds a Durable Object or Workflow class, or a named entrypoint of the Worker itself, that the Worker doesn't export, `vite` and `vite build` fail and name it, along with the app's server entry (`server.ts`, or the file Huuma's `server` option names), instead of workerd's `Class extends value undefined is not a constructor or null`:

```
wrangler.jsonc binds the Durable Object class "ChatRoom", but the Worker doesn't export it. Export it from server.ts, e.g. `export { ChatRoom } from "./chat-room.ts";`
```

Bindings of another Worker's classes, with its `script_name` or `service`, aren't checked; that Worker exports them.

A Worker of the app's own is still possible, e.g. for `scheduled` or `queue` handlers, which the adapter's Worker doesn't have: name it as `main` in `wrangler.jsonc` and pass the requests to the app.

```js
// worker.js
import huuma from "virtual:huuma/worker";

// The named exports of server.ts, e.g. ChatRoom.
export * from "virtual:huuma/worker";

export default {
  fetch: (request, env, ctx) => huuma.fetch(request, env, ctx),
  scheduled(controller, env, ctx) {},
};
```

The build then checks that this Worker exports the classes `wrangler.jsonc` binds, and names `worker.js` if it doesn't. In dev, the check only runs for the adapter's Worker.

## Options

`cloudflare()` takes the options of `@cloudflare/vite-plugin`, e.g. `configPath`, `remoteBindings` or `inspectorPort`, except `viteEnvironment`. See [Cloudflare Workers](https://github.com/huuma-studio/ui/tree/next#cloudflare-workers) in Huuma UI's README for caching, the base and bindings.

Needs `@huuma/ui` 0.3 with adapters and the named exports of `server.ts` (`^0.3.0-beta.4`).

## Development

```sh
pnpm install
vp check
vp test               # the browser tests need Chromium: pnpm exec playwright-core install chromium
vp run jsr:dry-run
```

`package.json` takes `@huuma/ui` from JSR's npm registry (`npm:@jsr/huuma__ui@^0.3.0-beta.4`), like `@huuma/route`. To try changes to `@huuma/ui` before they're released, link a checkout of [huuma-studio/ui](https://github.com/huuma-studio/ui) instead. JSR publishes from `jsr.json`, whose import map names the JSR and npm versions; `package.json` only drives the Node tooling.
