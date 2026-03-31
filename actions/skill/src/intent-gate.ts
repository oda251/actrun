import { readFileSync } from "node:fs";
import { ok, err, type Result } from "neverthrow";
import type { Citation, EvidencedInput, InputEntry } from "./types.js";

export interface VerificationResult {
  key: string;
  citation: Citation;
  ok: boolean;
  detail?: string;
}

export type EvidenceVerifier = (
  entries: { key: string; entry: EvidencedInput }[],
  transcriptPath?: string,
) => Promise<VerificationResult[]>;

export function createDefaultVerifier(): EvidenceVerifier {
  return async (entries, transcriptPath) => {
    const tasks = entries.flatMap(({ key, entry }) =>
      entry.citations
        .filter((c) => c.excerpt)
        .map((c) => verifyCitation(key, c, transcriptPath)),
    );
    return Promise.all(tasks);
  };
}

export async function runIntentGate(
  inputs: Record<string, InputEntry>,
  verifier: EvidenceVerifier,
  transcriptPath?: string,
): Promise<Result<undefined, string>> {
  const evidenced: { key: string; entry: EvidencedInput }[] = [];
  for (const [key, entry] of Object.entries(inputs)) {
    if (entry.type === "evidenced") evidenced.push({ key, entry });
  }

  if (evidenced.length === 0) return ok(undefined);

  const results = await verifier(evidenced, transcriptPath);
  const failed = results.filter((r): r is VerificationResult & { detail: string } => !r.ok && !!r.detail);

  if (failed.length > 0) {
    return err(failed.map((r) => `${r.key}: ${r.detail}`).join("; "));
  }

  return ok(undefined);
}

async function verifyCitation(
  key: string,
  citation: Citation,
  transcriptPath?: string,
): Promise<VerificationResult> {
  switch (citation.type) {
    case "transcript":
      return verifyTextFile(key, citation, transcriptPath);
    case "command":
      // Command output is ephemeral; re-execution may have side effects
      return { key, citation, ok: true };
    case "uri":
      if (isFilePath(citation.source)) {
        return isTextFile(citation.source)
          ? verifyTextFile(key, citation, citation.source)
          : { key, citation, ok: true };
      }
      return verifyUri(key, citation);
  }
}

function verifyTextFile(
  key: string,
  citation: Citation,
  path?: string,
): VerificationResult {
  if (!path) {
    return { key, citation, ok: false, detail: "source path not available" };
  }

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return { key, citation, ok: false, detail: `cannot read: ${path}` };
  }

  const found = content.includes(citation.excerpt);
  return { key, citation, ok: found, detail: found ? undefined : `excerpt not found in ${path}` };
}

async function verifyUri(
  key: string,
  citation: Citation & { type: "uri" },
): Promise<VerificationResult> {
  try {
    const res = await fetch(citation.source, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return { key, citation, ok: true };
    return { key, citation, ok: false, detail: `${citation.source} returned ${res.status}` };
  } catch {
    return { key, citation, ok: false, detail: `cannot reach: ${citation.source}` };
  }
}

function isFilePath(source: string): boolean {
  try {
    return !URL.canParse(source);
  } catch {
    return true;
  }
}

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonl", ".yaml", ".yml", ".toml",
  ".html", ".htm", ".css", ".scss",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".sh", ".bash", ".zsh", ".fish",
  ".sql", ".graphql", ".gql",
  ".xml", ".svg", ".csv", ".tsv",
  ".env", ".ini", ".cfg", ".conf",
  ".lock", ".log",
  ".vue", ".svelte", ".astro",
  ".mbt", ".zig", ".nix",
]);

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
