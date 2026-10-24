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

`cloudflare()` takes the options of `@cloudflare/vite-plugin`, e.g. `configPath`, `remoteBindings` or `inspectorPort`, except `viteEnvironment`. See [Cloudflare Workers](https://github.com/huuma-studio/ui/tree/next#cloudflare-workers) in Huuma UI's README for caching, the base and bindings.

Needs `@huuma/ui` 0.3 with adapters (`^0.3.0-beta.3`).

## Development

```sh
pnpm install
vp check
vp test               # the browser tests need Chromium: pnpm exec playwright-core install chromium
vp run jsr:dry-run
```

Until `@huuma/ui` with `@huuma/ui/vite/adapter` is on JSR, `package.json` links it from `../ui`, a checkout of [huuma-studio/ui](https://github.com/huuma-studio/ui) on its `next` branch. Then it becomes `npm:@jsr/huuma__ui@^0.3.0-beta.3`, like `@huuma/route`. JSR publishes from `jsr.json`, whose import map names the JSR and npm versions; `package.json` only drives the Node tooling.
