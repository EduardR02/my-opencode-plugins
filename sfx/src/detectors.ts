/**
 * Detect test failures from bash tool output.
 *
 * Simple two-rule approach:
 * 1. Recognized test command + non-zero exit code = failure
 * 2. Non-test command + explicit test-runner output ("Tests: N failed" with N>0) = failure
 */
export function containsTestFailure(
  output: string,
  metadata: Record<string, unknown> | null | undefined,
  args: unknown,
): boolean {
  const exitCode = getExitCode(metadata);
  const command = extractCommand(args);

  // Rule 1: Recognized test command — trust the exit code
  if (command && isTestCommand(command)) {
    return exitCode !== null && exitCode !== 0;
  }

  // Rule 2: Non-test command — only catch explicit test-runner summary lines
  return hasTestRunnerSummary(output);
}

function getExitCode(metadata: Record<string, unknown> | null | undefined): number | null {
  if (metadata == null) return null;
  const code = metadata.exitCode ?? metadata.exit_code ?? metadata.exit;
  return typeof code === "number" ? code : null;
}

/** Extract the command string from bash tool arguments */
function extractCommand(args: unknown): string | null {
  if (!args) return null;
  if (typeof args === "string") return args;
  if (typeof args === "object" && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    for (const key of ["command", "cmd", "script", "args", "argv"]) {
      const val = obj[key];
      if (typeof val === "string" && val.length > 0) return val;
      if (Array.isArray(val) && val.length > 0) return val.join(" ");
    }
  }
  return null;
}

/** Check if a command string looks like it's running tests */
function isTestCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return (
    // JS/TS
    /\b(npm|yarn|pnpm|bun)\s+(test|t)\b/.test(lower) ||
    /\b(npx|bunx)\s+(jest|vitest|mocha|ava|playwright|cypress)\b/.test(lower) ||
    /\b(jest|vitest|mocha|ava|tap|tape|jasmine|karma)\b/.test(lower) ||
    // Python
    /\b(pytest|python.*-m\s+(pytest|unittest)|nosetests|tox)\b/.test(lower) ||
    // Rust / Go / C
    /\b(cargo\s+test|go\s+test|make\s+test|make\s+check)\b/.test(lower) ||
    // Ruby / PHP / .NET
    /\b(rspec|cucumber|phpunit|pest|behat|dotnet\s+test|nunit|xunit)\b/.test(lower) ||
    // Generic
    /\bctest\b/.test(lower)
  );
}

/**
 * Check for explicit test-runner summary output.
 * Only matches patterns highly specific to test frameworks.
 */
function hasTestRunnerSummary(text: string): boolean {
  if (!text || text.length === 0) return false;

  // "Tests: N failed" with N > 0
  const testsMatch = text.match(/Tests:\s*(\d+)\s+failed/i);
  if (testsMatch && parseInt(testsMatch[1], 10) > 0) return true;

  // "N failing" — Jest/Vitest summary: "1 failing", "2 failing"
  if (/(\d+)\s+failing\b/.test(text)) return true;

  return false;
}
