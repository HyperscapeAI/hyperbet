import {
  assertMitigationThreshold,
  runAdversarialSuite,
  runCli,
  SCENARIOS,
  toMarkdownSummary,
} from "./adversarial/index.js";

if (process.argv[1]?.includes("simulate-adversarial")) {
  runCli();
}

export { assertMitigationThreshold, runAdversarialSuite, SCENARIOS, toMarkdownSummary };
