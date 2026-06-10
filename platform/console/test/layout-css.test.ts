import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("console layout CSS", () => {
  test("centers the primary console content horizontally", async () => {
    const css = await readFile(resolve("src/styles.css"), "utf8");
    const shellRule = /\.console-shell\s*\{(?<body>[^}]*)\}/u.exec(css)?.groups?.body ?? "";

    expect(shellRule).toContain("display: grid");
    expect(shellRule).toContain("justify-items: center");
  });

  test("defines a bounded operational console entry layout", async () => {
    const css = await readFile(resolve("src/styles.css"), "utf8");
    expect(css).toContain(".console-entry");
    expect(css).toContain("width: min(100%, 720px)");
    expect(css).not.toContain(".web-landing");
    expect(css).not.toContain(".landing-grid");
    expect(css).not.toContain(".download-card");
  });
});
