import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";

// jsr.json is the JSR manifest; package.json drives the Node tooling. JSR
// publish rejects `jsr:` in package.json, so the dependencies are listed
// in both: in jsr.json's import map (published) and in package.json
// (installed by pnpm).
const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const jsr = read("jsr.json");
const pkg = read("package.json");

describe("manifests", () => {
  test("export the same entry points", () => {
    expect(pkg.exports).toStrictEqual(jsr.exports);
  });

  test("share the package's name", () => {
    // The Worker entry, generated in the app, imports `@huuma/cloudflare/
    // runtime`: in the fixtures here, it resolves to this package by name.
    expect(pkg.name).toStrictEqual(jsr.name);
  });

  test("declare the same npm dependencies, and Vite", () => {
    expect(jsr.imports["@cloudflare/vite-plugin"]).toStrictEqual(
      `npm:@cloudflare/vite-plugin@${pkg.dependencies["@cloudflare/vite-plugin"]}`,
    );
    expect(jsr.imports.vite).toStrictEqual(`npm:vite@${pkg.devDependencies.vite}`);
  });

  test("import @huuma/ui from JSR, from ../ui until it's published", () => {
    expect(jsr.imports["@huuma/ui"]).toMatch(/^jsr:@huuma\/ui@\^0\.3\./);
    expect(pkg.dependencies["@huuma/ui"]).toMatch(/^(link:\.\.\/ui|npm:@jsr\/huuma__ui@\^0\.3\.)/);
  });
});
