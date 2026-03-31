import { readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { query, type ResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { createDefaultVerifier, runIntentGate } from "./intent-gate.js";
import type { InputEntry, InputSpec } from "./types.js";

interface SkillFrontmatter {
  provider?: string;
  model?: string;
  tools?: string[];
  "permission-mode"?: string;
  inputs?: Record<string, string | InputSpec>;
  [key: string]: unknown;
}

function getInput(name: string, required = false): string {
  const val = process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
  if (required && !val) {
    console.error(`Error: '${name}' input is required`);
    process.exit(1);
  }
  return val;
}

function normalizeInputSpec(val: string | InputSpec): InputSpec {
  return typeof val === "string" ? { description: val, type: "evidenced" } : val;
}

function validateInputs(
  provided: Record<string, InputEntry>,
  declared?: Record<string, string | InputSpec>,
): string[] {
  if (!declared) return [];
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(declared)) {
    const spec = normalizeInputSpec(raw);
    if (!(key in provided)) {
      errors.push(`missing: ${key}`);
      continue;
    }
    const entry = provided[key];
    if (entry.type !== spec.type) {
      errors.push(`${key}: expected ${spec.type}, got ${entry.type}`);
    }
  }
  return errors;
}

function formatInputs(inputs: Record<string, InputEntry>): string {
  return Object.entries(inputs)
    .map(([key, entry]) => {
      if (entry.type === "plain") return `- **${key}**: ${entry.value}`;
      const lines = [`- **${key}**: ${entry.body}`];
      for (const c of entry.citations) {
        const source = c.type === "transcript"
          ? "(transcript)"
          : c.type === "command"
            ? c.command
            : c.source;
        lines.push(`  - source: \`${source}\` — "${c.excerpt}"`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function extractRequiredOutputs(workflowPath: string, stepId: string): string[] {
  if (!workflowPath || !stepId) return [];

  let content: string;
  try {
    content = readFileSync(workflowPath, "utf-8");
  } catch {
    return [];
  }

  const pattern = new RegExp(`\\$\\{\\{\\s*steps\\.${stepId}\\.outputs\\.(\\w+)\\s*\\}\\}`, "g");
  const keys = new Set<string>();
  let match;
  while ((match = pattern.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

function buildPrompt(
  body: string,
  inputs: Record<string, InputEntry>,
  requiredOutputs: string[],
  workflowFile?: string,
): string {
  const sections = [
    `## Task\n\n### Inputs\n\n${formatInputs(inputs)}`,
  ];

  if (requiredOutputs.length > 0) {
    const outputLines = requiredOutputs
      .map((key) => `- **${key}**`)
      .join("\n");
    sections.push(`### Outputs\n\n完了時に以下を GITHUB_OUTPUT に書き込む:\n\necho "key=value" >> $GITHUB_OUTPUT\n\n${outputLines}`);
  }

  if (workflowFile) {
    sections.push(`### Context\n\nWorkflow: \`${workflowFile}\``);
  }

  sections.push(`## Workflow\n\n${body}`);
  sections.push(`## Protocol\n\ninputs が不十分なら:\n  echo "reject_reason=理由" >> $GITHUB_OUTPUT\n  exit 1\n\n完了したら outputs を GITHUB_OUTPUT に書き込む。`);

  return sections.join("\n\n");
}

const VALID_PERMISSION_MODES = ["auto", "plan", "default", "acceptEdits", "bypassPermissions"] as const;
type PermissionMode = (typeof VALID_PERMISSION_MODES)[number];

function validatePermissionMode(mode?: string): PermissionMode | undefined {
  if (!mode) return undefined;
  if (VALID_PERMISSION_MODES.includes(mode as PermissionMode)) return mode as PermissionMode;
  console.warn(`[skill] Unknown permission-mode: ${mode}, defaulting to auto`);
  return "auto";
}

type Provider = (prompt: string, options: {
  cwd: string;
  model?: string;
  tools?: string[];
  permissionMode?: string;
}) => Promise<string>;

const claudeProvider: Provider = async (prompt, options) => {
  let resultText = "";

  for await (const message of query({
    prompt,
    options: {
      cwd: options.cwd,
      model: options.model,
      allowedTools: options.tools,
      permissionMode: validatePermissionMode(options.permissionMode),
      allowDangerouslySkipPermissions: true,
      maxTurns: 50,
    },
  })) {
    if ("result" in message) {
      resultText = (message as ResultMessage).result;
    }
  }

  return resultText;
};

const providers: Record<string, Provider> = {
  claude: claudeProvider,
};

async function main() {
  const skill = getInput("skill", true);
  const inputsJson = getInput("inputs", true);
  const transcriptPath = process.env.TRANSCRIPT_PATH;
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  const skillPath = join(cwd, ".claude", "skills", `${skill}.md`);
  if (!existsSync(skillPath)) {
    console.error(`Error: Skill file not found: ${skillPath}`);
    process.exit(1);
  }

  const raw = readFileSync(skillPath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as SkillFrontmatter;
  const body = content.trim();

  let inputs: Record<string, InputEntry>;
  try {
    inputs = JSON.parse(inputsJson);
  } catch (e) {
    console.error(`Error: Failed to parse inputs: ${(e as Error).message}`);
    process.exit(1);
  }

  const inputErrors = validateInputs(inputs, frontmatter.inputs);
  if (inputErrors.length > 0) {
    console.error(`[skill] Invalid inputs: ${inputErrors.join("; ")}`);
    process.exit(1);
  }

  const verifier = createDefaultVerifier();
  const gate = await runIntentGate(inputs, verifier, transcriptPath);
  if (gate.isErr()) {
    console.error(`[skill] Intent Gate failed: ${gate.error}`);
    process.exit(1);
  }

  const providerName = frontmatter.provider ?? "claude";
  const provider = providers[providerName];
  if (!provider) {
    console.error(`Error: Unknown provider: ${providerName}`);
    process.exit(1);
  }

  // Extract required outputs from workflow wiring
  const workflowFile = process.env.GITHUB_WORKFLOW;
  const stepId = process.env.GITHUB_ACTION || "";
  const workflowPath = workflowFile ? join(cwd, workflowFile) : "";
  const requiredOutputs = extractRequiredOutputs(workflowPath, stepId);

  const prompt = buildPrompt(body, inputs, requiredOutputs, workflowFile);
  console.log(`[skill] Running: ${skill} (provider: ${providerName}${frontmatter.model ? `, model: ${frontmatter.model}` : ""})`);

  await provider(prompt, {
    cwd,
    model: frontmatter.model,
    tools: frontmatter.tools,
    permissionMode: frontmatter["permission-mode"],
  });

  console.log(`[skill] Completed: ${skill}`);
}

main().catch((e) => {
  console.error(`[skill] Fatal: ${(e as Error).message}`);
  process.exit(1);
});
