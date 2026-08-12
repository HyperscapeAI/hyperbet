import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type LaunchProgram = "fight_oracle" | "duel_market";

const launchPrograms = new Set<LaunchProgram>(["fight_oracle", "duel_market"]);

const commonRuntimeSymbols = [
  "abort",
  "sol_create_program_address",
  "sol_get_clock_sysvar",
  "sol_get_rent_sysvar",
  "sol_invoke_signed_rust",
  "sol_log_",
  "sol_log_data",
  "sol_log_pubkey",
  "sol_memcpy_",
  "sol_memset_",
  "sol_sha256",
  "sol_try_find_program_address",
] as const;

const expectedUndefinedSymbols: Record<LaunchProgram, readonly string[]> = {
  fight_oracle: [...commonRuntimeSymbols, "sol_keccak256"].sort(),
  duel_market: [...commonRuntimeSymbols].sort(),
};

const crateTypeWarning =
  /WARN\s+cargo_build_sbf\]\s+Package '([^']+)' has two crate types defined: cdylib and lib\. This setting precludes link-time optimizations \(LTO\)\. Use cdylib for programs to be deployed and rlib for packages to be imported by other programs as libraries\.$/;
const undefinedSymbolsWarning =
  /WARN\s+cargo_build_sbf::post_processing\]\s+The following functions are undefined and not known syscalls (\[[^\]]+\])\.$/;
const runtimeErrorContinuation =
  /WARN\s+cargo_build_sbf::post_processing\]\s+Calling them will trigger a run-time error\.$/;

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function auditSbfBuildLog(
  log: string,
  expectedPrograms: readonly LaunchProgram[],
): string[] {
  const failures: string[] = [];
  const expectedProgramSet = new Set(expectedPrograms);
  if (
    expectedPrograms.length === 0 ||
    expectedProgramSet.size !== expectedPrograms.length
  ) {
    failures.push("expected launch programs must be a non-empty unique list");
  }

  const actualCratePrograms: string[] = [];
  const actualUndefinedSets: string[][] = [];
  let runtimeContinuationCount = 0;

  for (const [index, line] of log.split(/\r?\n/).entries()) {
    const crateMatch = line.match(crateTypeWarning);
    if (crateMatch) {
      actualCratePrograms.push(crateMatch[1] ?? "");
      continue;
    }

    const undefinedMatch = line.match(undefinedSymbolsWarning);
    if (undefinedMatch) {
      try {
        const symbols = JSON.parse(undefinedMatch[1] ?? "") as unknown;
        if (
          !Array.isArray(symbols) ||
          symbols.some((symbol) => typeof symbol !== "string")
        ) {
          failures.push(
            `line ${index + 1}: undefined-symbol warning is not a string array`,
          );
        } else {
          actualUndefinedSets.push([...symbols].sort());
        }
      } catch {
        failures.push(
          `line ${index + 1}: undefined-symbol warning contains invalid JSON`,
        );
      }
      continue;
    }

    if (runtimeErrorContinuation.test(line)) {
      runtimeContinuationCount += 1;
      continue;
    }

    if (/\bWARN\b|^warning(?:\[|:)/i.test(line)) {
      failures.push(`line ${index + 1}: unclassified SBF warning: ${line}`);
    }
  }

  const sortedActualPrograms = [...actualCratePrograms].sort();
  const sortedExpectedPrograms = [...expectedPrograms].sort();
  if (!sameStrings(sortedActualPrograms, sortedExpectedPrograms)) {
    failures.push(
      `crate-type warnings expected ${sortedExpectedPrograms.join(", ")}; found ${sortedActualPrograms.join(", ") || "none"}`,
    );
  }

  const unmatchedUndefinedSets = [...actualUndefinedSets];
  for (const program of expectedPrograms) {
    const expectedSymbols = expectedUndefinedSymbols[program];
    const matchIndex = unmatchedUndefinedSets.findIndex((symbols) =>
      sameStrings(symbols, expectedSymbols),
    );
    if (matchIndex < 0) {
      failures.push(
        `${program}: missing exact classified runtime-symbol warning [${expectedSymbols.join(", ")}]`,
      );
    } else {
      unmatchedUndefinedSets.splice(matchIndex, 1);
    }
  }
  for (const symbols of unmatchedUndefinedSets) {
    failures.push(
      `unexpected undefined-symbol warning [${symbols.join(", ")}]`,
    );
  }

  if (runtimeContinuationCount !== actualUndefinedSets.length) {
    failures.push(
      `runtime-error continuation count ${runtimeContinuationCount} does not match undefined-symbol warning count ${actualUndefinedSets.length}`,
    );
  }

  return failures;
}

function parseExpectedPrograms(values: string[]): LaunchProgram[] {
  const invalid = values.filter(
    (value) => !launchPrograms.has(value as LaunchProgram),
  );
  if (invalid.length > 0) {
    throw new Error(`unknown launch program(s): ${invalid.join(", ")}`);
  }
  return values as LaunchProgram[];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [logPath, ...programValues] = process.argv.slice(2);
  if (!logPath) {
    console.error(
      "usage: bun audit-sbf-build-log.ts <build-log> <launch-program>...",
    );
    process.exit(2);
  }

  try {
    const expectedPrograms = parseExpectedPrograms(programValues);
    const failures = auditSbfBuildLog(
      readFileSync(logPath, "utf8"),
      expectedPrograms,
    );
    if (failures.length > 0) {
      console.error("SBF build warning audit failed:");
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
    console.log(
      `SBF build warning audit passed: ${expectedPrograms.join(", ")} emitted only the exact classified Anchor/runtime warning set.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
