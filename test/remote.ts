// The endpoint of a remote module, as @huuma/ui serves it: a copy of its
// internal `remoteEndpoint()`, which isn't an entry point. If @huuma/ui
// changes it, the remote function tests fail with a 404.
import { posix } from "node:path";

export async function remoteEndpoint(path: string): Promise<string> {
  const canonical = "/" + path.replaceAll("\\", "/").replace(/^\/+/, "");
  const data = new TextEncoder().encode(canonical);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `/_huuma/remote/${hash}/${posix.parse(canonical).name}`;
}
