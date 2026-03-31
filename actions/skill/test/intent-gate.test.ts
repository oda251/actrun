import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultVerifier } from "../src/intent-gate.js";
import type { EvidencedInput } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidekick-evidence-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function entry(key: string, input: EvidencedInput) {
  return [{ key, entry: input }];
}

describe("createDefaultVerifier", () => {
  const verify = createDefaultVerifier();

  it("finds excerpt in a text file (transcript)", async () => {
    const transcript = join(tmpDir, "session.jsonl");
    writeFileSync(transcript, '{"type":"user","message":{"content":"JWT認証に移行したい"}}\n');

    const results = await verify(
      entry("what", {
        type: "evidenced",
        body: "JWT に移行",
        citations: [{ type: "transcript", excerpt: "JWT認証に移行したい" }],
      }),
      transcript,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  it("reports missing excerpt in transcript", async () => {
    const transcript = join(tmpDir, "session.jsonl");
    writeFileSync(transcript, '{"type":"user","message":{"content":"hello"}}\n');

    const results = await verify(
      entry("what", {
        type: "evidenced",
        body: "JWT に移行",
        citations: [{ type: "transcript", excerpt: "存在しないテキスト" }],
      }),
      transcript,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain("not found");
  });

  it("finds excerpt in a source file (uri)", async () => {
    const srcFile = join(tmpDir, "auth.ts");
    writeFileSync(srcFile, 'app.use(session({ store: new RedisStore() }))');

    const results = await verify(
      entry("where", {
        type: "evidenced",
        body: "認証ミドルウェア",
        citations: [{ type: "uri", source: srcFile, excerpt: "RedisStore" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  it("reports missing excerpt in source file", async () => {
    const srcFile = join(tmpDir, "auth.ts");
    writeFileSync(srcFile, "const x = 1;");

    const results = await verify(
      entry("where", {
        type: "evidenced",
        body: "認証",
        citations: [{ type: "uri", source: srcFile, excerpt: "RedisStore" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });

  it("reports unreadable file", async () => {
    const results = await verify(
      entry("what", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "uri", source: "/nonexistent/file.ts", excerpt: "anything" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain("cannot read");
  });

  it("checks URL existence for http URIs", async () => {
    const results = await verify(
      entry("ref", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "uri", source: "https://httpbin.org/status/200", excerpt: "anything" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  it("reports unreachable URL", async () => {
    const results = await verify(
      entry("ref", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "uri", source: "https://httpbin.org/status/404", excerpt: "anything" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain("404");
  });

  it("skips citations without excerpt", async () => {
    const results = await verify(
      entry("what", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "uri", source: "/some/file", excerpt: "" }],
      }),
    );

    expect(results).toHaveLength(0);
  });

  it("passes through command citations without verification", async () => {
    const results = await verify(
      entry("ref", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "command", command: "git log --oneline -5", excerpt: "anything" }],
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  it("reports missing transcript path", async () => {
    const results = await verify(
      entry("what", {
        type: "evidenced",
        body: "test",
        citations: [{ type: "transcript", excerpt: "something" }],
      }),
      undefined,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain("not available");
  });
});
