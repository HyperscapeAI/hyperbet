import { createHash } from "node:crypto";

export type StreamingAgent = {
  id: string;
  name: string;
  provider: string;
  model: string;
  hp: number;
  maxHp: number;
  combatLevel: number;
  wins: number;
  losses: number;
  damageDealtThisFight: number;
  rank: number;
  headToHeadWins: number;
  headToHeadLosses: number;
};

export type CompetitiveSnapshot = {
  snapshotVersion: 1 | 2 | 3;
  persisted: true;
  diagnostic: false;
  preparationId: string;
  cycleId: string;
  duelId: string;
  duelKey: string;
  frozenAt: number;
  betOpenTime: number;
  betCloseTime: number;
  combatPolicyVersion: string;
  contestants: [Record<string, unknown>, Record<string, unknown>];
};

const FROZEN_ARMOR_SLOTS = [
  "helmet",
  "body",
  "legs",
  "boots",
  "gloves",
  "cape",
  "amulet",
  "ring",
] as const;

export type StreamingWinReason =
  | "kill"
  | "forfeit"
  | "hp_advantage"
  | "damage_advantage"
  | "draw";

export type StreamingCycle = {
  sourceEpoch: number;
  seq: number;
  emittedAt: number;
  phaseVersion: number;
  cycleId: string;
  phase: string;
  duelId: string | null;
  duelKeyHex: string | null;
  competitiveSnapshotVersion: number | null;
  competitiveSnapshotDigest: string | null;
  competitiveSnapshot: CompetitiveSnapshot | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  winnerId: string | null;
  outcome: "win" | "draw" | "cancelled" | null;
  cancellationReason: string | null;
  winReason: StreamingWinReason | null;
  seed: string | null;
  replayHash: string | null;
  agent1: StreamingAgent | null;
  agent2: StreamingAgent | null;
};

export type BettingFeedStateUpdate = {
  schemaVersion?: number;
  sourceEpoch?: number;
  seq?: number;
  emittedAt?: number;
  phaseVersion?: number;
  duelId?: string | null;
  duelKey?: string | null;
  competitiveSnapshotVersion?: number | null;
  competitiveSnapshotDigest?: string | null;
  competitiveSnapshot?: unknown;
  phase?: string | null;
  betOpenTime?: number | null;
  betCloseTime?: number | null;
  fightStartTime?: number | null;
  duelEndTime?: number | null;
  winnerId?: string | null;
  outcome?: "win" | "draw" | "cancelled" | null;
  cancellationReason?: string | null;
  winReason?: StreamingWinReason | null;
  seed?: string | null;
  replayHash?: string | null;
  agent1?: StreamingAgent | null;
  agent2?: StreamingAgent | null;
  arenaPositions?: unknown;
  winnerName?: string | null;
  rendererHealth?: unknown;
};

export type DuelLifecycleEvent = {
  sourceEpoch: number;
  seq: number;
  emittedAt: number;
  phaseVersion: number;
  cycleId: string;
  duelId: string;
  duelKeyHex: string;
  competitiveSnapshotVersion: number;
  competitiveSnapshotDigest: string;
  competitiveSnapshot: CompetitiveSnapshot;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  phase: string;
  winnerId: string | null;
  outcome: "win" | "draw" | "cancelled" | null;
  cancellationReason: string | null;
  winReason: StreamingWinReason | null;
  seed: string | null;
  replayHash: string | null;
  agent1: StreamingAgent | null;
  agent2: StreamingAgent | null;
};

export type BettingFeedCheckpoint = {
  sourceEpoch: number;
  lastAppliedSeq: number;
  lastEmittedAt: number;
  duelId: string | null;
  competitiveSnapshotDigest: string | null;
  phase: string | null;
  terminal: boolean;
  degradedReason: string | null;
  updatedAt: number;
};

export type BettingFeedCheckpointStore = {
  getBettingFeedCheckpoint(): BettingFeedCheckpoint | null;
  saveBettingFeedCheckpoint(
    checkpoint: Omit<BettingFeedCheckpoint, "degradedReason" | "updatedAt"> & {
      updatedAt?: number;
    },
  ): BettingFeedCheckpoint;
  markBettingFeedDegraded(reason: unknown, now?: number): void;
};

export class BettingFeedContinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BettingFeedContinuityError";
  }
}

export function normalizeLifecycleEvent(
  cycle: StreamingCycle,
): DuelLifecycleEvent | null {
  if (!cycle.duelId || !cycle.duelKeyHex) {
    return null;
  }

  return {
    sourceEpoch: cycle.sourceEpoch,
    seq: cycle.seq,
    emittedAt: cycle.emittedAt,
    phaseVersion: cycle.phaseVersion,
    cycleId: cycle.cycleId,
    duelId: cycle.duelId,
    duelKeyHex: cycle.duelKeyHex,
    competitiveSnapshotVersion: cycle.competitiveSnapshotVersion!,
    competitiveSnapshotDigest: cycle.competitiveSnapshotDigest!,
    competitiveSnapshot: cycle.competitiveSnapshot!,
    betOpenTime: cycle.betOpenTime,
    betCloseTime: cycle.betCloseTime,
    fightStartTime: cycle.fightStartTime,
    duelEndTime: cycle.duelEndTime,
    phase: cycle.phase,
    winnerId: cycle.winnerId,
    outcome: cycle.outcome ?? null,
    cancellationReason: cycle.cancellationReason ?? null,
    winReason: cycle.winReason,
    seed: cycle.seed,
    replayHash: cycle.replayHash,
    agent1: cycle.agent1,
    agent2: cycle.agent2,
  };
}

const BETTING_FEED_PHASES = new Set([
  "IDLE",
  "ANNOUNCEMENT",
  "COUNTDOWN",
  "FIGHTING",
  "RESOLUTION",
]);

function isNullableSafeTimestamp(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && Number(value) > 0);
}

function isNullableNonemptyString(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && value.trim().length > 0)
  );
}

function isCanonicalAgent(value: unknown): value is StreamingAgent | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const agent = value as Partial<StreamingAgent>;
  return (
    hasExactKeys(value, [
      "id",
      "name",
      "provider",
      "model",
      "hp",
      "maxHp",
      "combatLevel",
      "wins",
      "losses",
      "damageDealtThisFight",
      "rank",
      "headToHeadWins",
      "headToHeadLosses",
    ]) &&
    typeof agent.id === "string" &&
    agent.id.trim().length > 0 &&
    typeof agent.name === "string" &&
    agent.name.trim().length > 0 &&
    isNonemptyText(agent.provider, 128) &&
    isNonemptyText(agent.model, 128) &&
    isSafeNonnegativeInteger(agent.hp) &&
    Number.isSafeInteger(agent.maxHp) &&
    Number(agent.maxHp) >= 1 &&
    Number(agent.hp) <= Number(agent.maxHp) &&
    Number.isSafeInteger(agent.combatLevel) &&
    Number(agent.combatLevel) >= 1 &&
    isSafeNonnegativeInteger(agent.wins) &&
    isSafeNonnegativeInteger(agent.losses) &&
    isSafeNonnegativeInteger(agent.damageDealtThisFight) &&
    isSafeNonnegativeInteger(agent.rank) &&
    isSafeNonnegativeInteger(agent.headToHeadWins) &&
    isSafeNonnegativeInteger(agent.headToHeadLosses)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return (
    actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index])
  );
}

function canonicalJson(value: unknown): string {
  const compareText = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!isRecord(candidate)) return candidate;
    return Object.fromEntries(
      Object.entries(candidate)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PREPARATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANCELLATION_REASON = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const COMBAT_STYLE_SET = new Set(["melee", "ranged", "mage"]);
const BETTING_FEED_KEYS = [
  "schemaVersion",
  "sourceEpoch",
  "seq",
  "emittedAt",
  "phaseVersion",
  "duelId",
  "duelKey",
  "competitiveSnapshotVersion",
  "competitiveSnapshotDigest",
  "competitiveSnapshot",
  "phase",
  "betOpenTime",
  "betCloseTime",
  "fightStartTime",
  "duelEndTime",
  "winnerId",
  "outcome",
  "cancellationReason",
  "winReason",
  "seed",
  "replayHash",
  "agent1",
  "agent2",
  "arenaPositions",
  "winnerName",
  "rendererHealth",
] as const;

function isNonemptyText(value: unknown, maxLength = 256): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isUint64Decimal(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
}

function isArenaPositions(
  value: unknown,
  active: boolean,
  allowReleasedArena: boolean,
): boolean {
  if (!active) return value === null;
  if (value === null) return allowReleasedArena;
  if (!isRecord(value) || !hasExactKeys(value, ["agent1", "agent2"])) {
    return false;
  }
  return [value.agent1, value.agent2].every(
    (position) =>
      Array.isArray(position) &&
      position.length === 3 &&
      position.every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      ),
  );
}

function isRendererHealth(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    hasExactKeys(value, ["ready", "degradedReason", "updatedAt"]) &&
    typeof value.ready === "boolean" &&
    isNullableNonemptyString(value.degradedReason) &&
    Number.isSafeInteger(value.updatedAt) &&
    Number(value.updatedAt) > 0,
  );
}

function isCombatStyle(value: unknown): value is "melee" | "ranged" | "mage" {
  return typeof value === "string" && COMBAT_STYLE_SET.has(value);
}

function isUniqueStyleArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 3 &&
    value.every(isCombatStyle) &&
    new Set(value).size === value.length
  );
}

function isCompetitiveEquipment(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 16) return false;
  const slots = new Set<string>();
  return value.every((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["slot", "itemId", "quantity"]) ||
      !isNonemptyText(entry.slot, 64) ||
      !isNonemptyText(entry.itemId, 128) ||
      !Number.isSafeInteger(entry.quantity) ||
      Number(entry.quantity) <= 0 ||
      slots.has(entry.slot)
    ) {
      return false;
    }
    slots.add(entry.slot);
    return true;
  });
}

function isCompetitiveInventory(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 28) return false;
  const slots = new Set<number>();
  return value.every((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["slot", "itemId", "quantity"]) ||
      !Number.isSafeInteger(entry.slot) ||
      Number(entry.slot) < 0 ||
      Number(entry.slot) >= 28 ||
      !isNonemptyText(entry.itemId, 128) ||
      !Number.isSafeInteger(entry.quantity) ||
      Number(entry.quantity) <= 0 ||
      slots.has(Number(entry.slot))
    ) {
      return false;
    }
    slots.add(Number(entry.slot));
    return true;
  });
}

function isCompetitiveSkillLevels(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return false;
  }
  const skills = new Set<string>();
  return value.every((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["skill", "level"]) ||
      !isNonemptyText(entry.skill, 64) ||
      !Number.isSafeInteger(entry.level) ||
      Number(entry.level) < 1 ||
      skills.has(entry.skill)
    ) {
      return false;
    }
    skills.add(entry.skill);
    return true;
  });
}

function isCompetitivePrayer(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "pointUnits",
      "points",
      "maxPoints",
      "activePrayers",
    ]) ||
    !isSafeNonnegativeInteger(value.pointUnits) ||
    typeof value.points !== "number" ||
    !Number.isFinite(value.points) ||
    value.points < 0 ||
    !Number.isSafeInteger(value.maxPoints) ||
    Number(value.maxPoints) < 1 ||
    value.points > Number(value.maxPoints) ||
    !Array.isArray(value.activePrayers) ||
    value.activePrayers.some((prayer) => !isNonemptyText(prayer, 128))
  ) {
    return false;
  }
  return new Set(value.activePrayers).size === value.activePrayers.length;
}

function isFrozenArmorIds(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, FROZEN_ARMOR_SLOTS) &&
    FROZEN_ARMOR_SLOTS.every((slot) => isNullableNonemptyString(value[slot]))
  );
}

function isCombatLoadouts(
  value: unknown,
  availableStyles: string[],
  snapshotVersion: CompetitiveSnapshot["snapshotVersion"],
): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((role) => !COMBAT_STYLE_SET.has(role))) {
    return false;
  }
  for (const role of availableStyles) {
    const loadout = value[role];
    const loadoutKeys = [
      "role",
      "weaponId",
      "arrowsId",
      "shieldId",
      "spellId",
      ...(snapshotVersion === 3 ? ["armorIds"] : []),
    ];
    if (
      !isRecord(loadout) ||
      !hasExactKeys(loadout, loadoutKeys) ||
      loadout.role !== role ||
      !isNonemptyText(loadout.weaponId, 128) ||
      !isNullableNonemptyString(loadout.arrowsId) ||
      !isNullableNonemptyString(loadout.shieldId) ||
      !isNullableNonemptyString(loadout.spellId) ||
      (snapshotVersion === 3 && !isFrozenArmorIds(loadout.armorIds))
    ) {
      return false;
    }
  }
  return Object.keys(value).length === availableStyles.length;
}

function isPreparationEvidence(
  value: unknown,
  snapshotVersion: CompetitiveSnapshot["snapshotVersion"],
  initialStyle: string,
  availableStyles: string[],
  provider: unknown,
  model: unknown,
): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "primaryStyle",
      "availableStyles",
      "planningSource",
      "planningPolicyVersion",
      "agentPolicyFingerprint",
      "modelProvider",
      "model",
      ...(snapshotVersion >= 2 ? ["tacticalStrategy"] : []),
    ]) ||
    value.primaryStyle !== initialStyle ||
    !isUniqueStyleArray(value.availableStyles) ||
    [...value.availableStyles].sort().join(",") !==
      [...availableStyles].sort().join(",") ||
    (value.planningSource !== "model" &&
      value.planningSource !== "deterministic") ||
    !isNonemptyText(value.planningPolicyVersion, 128) ||
    typeof value.agentPolicyFingerprint !== "string" ||
    !SHA256_HEX.test(value.agentPolicyFingerprint) ||
    !isNonemptyText(value.modelProvider, 128) ||
    !isNonemptyText(value.model, 128) ||
    value.modelProvider !== provider ||
    value.model !== model ||
    (snapshotVersion >= 2 &&
      !isCompetitiveTacticalStrategy(value.tacticalStrategy, availableStyles))
  ) {
    return false;
  }
  return true;
}

const TACTICAL_APPROACHES = new Set([
  "aggressive",
  "defensive",
  "balanced",
  "outlast",
]);
const TACTICAL_MACROS = new Set([
  "pressure",
  "hold_range",
  "kite",
  "orbit",
  "defensive_reset",
  "finish",
]);
const TACTICAL_ATTACK_STYLES = new Set([
  "accurate",
  "aggressive",
  "controlled",
  "defensive",
]);
const TACTICAL_PRAYERS = new Set([
  "superhuman_strength",
  "rock_skin",
  "hawk_eye",
  "mystic_lore",
]);

function normalizeTacticalReasoning(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function isCompetitiveTacticalStrategy(
  value: unknown,
  availableStyles: string[],
): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "approach",
      "tacticalMacro",
      "attackStyle",
      "prayer",
      "preferredCombatRole",
      "foodThreshold",
      "switchDefensiveAt",
      "reasoning",
    ]) ||
    typeof value.approach !== "string" ||
    !TACTICAL_APPROACHES.has(value.approach) ||
    typeof value.tacticalMacro !== "string" ||
    !TACTICAL_MACROS.has(value.tacticalMacro) ||
    typeof value.attackStyle !== "string" ||
    !TACTICAL_ATTACK_STYLES.has(value.attackStyle) ||
    !(
      value.prayer === null ||
      (typeof value.prayer === "string" && TACTICAL_PRAYERS.has(value.prayer))
    ) ||
    !(
      value.preferredCombatRole === null ||
      (typeof value.preferredCombatRole === "string" &&
        availableStyles.includes(value.preferredCombatRole))
    ) ||
    !Number.isSafeInteger(value.foodThreshold) ||
    Number(value.foodThreshold) < 20 ||
    Number(value.foodThreshold) > 60 ||
    !Number.isSafeInteger(value.switchDefensiveAt) ||
    Number(value.switchDefensiveAt) < 20 ||
    Number(value.switchDefensiveAt) > 40 ||
    !isNonemptyText(value.reasoning, 240) ||
    normalizeTacticalReasoning(value.reasoning) !== value.reasoning
  ) {
    return false;
  }
  return true;
}

const CONTESTANT_KEYS = [
  "side",
  "agentId",
  "name",
  "provider",
  "model",
  "combatLevel",
  "startingHp",
  "maxHp",
  "wins",
  "losses",
  "rank",
  "headToHeadWins",
  "headToHeadLosses",
  "loadoutFingerprint",
  "equipment",
  "inventory",
  "selectedSpell",
  "skillLevels",
  "prayer",
  "initialCombatStyle",
  "availableCombatStyles",
  "combatLoadouts",
  "preparation",
] as const;

function isCompetitiveContestant(
  value: unknown,
  snapshotVersion: CompetitiveSnapshot["snapshotVersion"],
  side: "agent1" | "agent2",
  agent: StreamingAgent,
): value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, CONTESTANT_KEYS)) return false;
  if (
    value.side !== side ||
    value.agentId !== agent.id ||
    value.name !== agent.name ||
    value.provider !== agent.provider ||
    value.model !== agent.model ||
    !isNonemptyText(value.provider, 128) ||
    !isNonemptyText(value.model, 128) ||
    !Number.isSafeInteger(value.combatLevel) ||
    Number(value.combatLevel) < 1 ||
    !Number.isSafeInteger(value.startingHp) ||
    Number(value.startingHp) < 1 ||
    !Number.isSafeInteger(value.maxHp) ||
    Number(value.maxHp) < Number(value.startingHp) ||
    !isSafeNonnegativeInteger(value.wins) ||
    !isSafeNonnegativeInteger(value.losses) ||
    !isSafeNonnegativeInteger(value.rank) ||
    !isSafeNonnegativeInteger(value.headToHeadWins) ||
    !isSafeNonnegativeInteger(value.headToHeadLosses) ||
    typeof value.loadoutFingerprint !== "string" ||
    !SHA256_HEX.test(value.loadoutFingerprint) ||
    !isCompetitiveEquipment(value.equipment) ||
    !isCompetitiveInventory(value.inventory) ||
    !isNullableNonemptyString(value.selectedSpell) ||
    !isCompetitiveSkillLevels(value.skillLevels) ||
    !isCompetitivePrayer(value.prayer) ||
    !isCombatStyle(value.initialCombatStyle) ||
    !isUniqueStyleArray(value.availableCombatStyles) ||
    !value.availableCombatStyles.includes(value.initialCombatStyle) ||
    !isCombatLoadouts(
      value.combatLoadouts,
      value.availableCombatStyles,
      snapshotVersion,
    ) ||
    !isPreparationEvidence(
      value.preparation,
      snapshotVersion,
      value.initialCombatStyle,
      value.availableCombatStyles,
      value.provider,
      value.model,
    )
  ) {
    return false;
  }
  return true;
}

function normalizeCompetitiveSnapshot(input: {
  snapshot: unknown;
  version: unknown;
  digest: unknown;
  duelId: string;
  duelKey: string;
  betOpenTime: number;
  betCloseTime: number;
  agent1: StreamingAgent;
  agent2: StreamingAgent;
  allowLegacyTerminalCancellation: boolean;
}): CompetitiveSnapshot | null {
  const snapshotVersion = isRecord(input.snapshot)
    ? input.snapshot.snapshotVersion
    : null;
  if (
    input.version !== snapshotVersion ||
    !(
      snapshotVersion === 3 ||
      ((snapshotVersion === 1 || snapshotVersion === 2) &&
        input.allowLegacyTerminalCancellation)
    ) ||
    typeof input.digest !== "string" ||
    !SHA256_HEX.test(input.digest) ||
    !isRecord(input.snapshot) ||
    !hasExactKeys(input.snapshot, [
      "snapshotVersion",
      "persisted",
      "diagnostic",
      "preparationId",
      "cycleId",
      "duelId",
      "duelKey",
      "frozenAt",
      "betOpenTime",
      "betCloseTime",
      "combatPolicyVersion",
      "contestants",
    ]) ||
    input.snapshot.persisted !== true ||
    input.snapshot.diagnostic !== false ||
    typeof input.snapshot.preparationId !== "string" ||
    !PREPARATION_UUID.test(input.snapshot.preparationId) ||
    !isNonemptyText(input.snapshot.cycleId, 128) ||
    input.snapshot.duelId !== input.duelId ||
    input.snapshot.duelKey !== input.duelKey ||
    input.snapshot.frozenAt !== input.betOpenTime ||
    input.snapshot.betOpenTime !== input.betOpenTime ||
    input.snapshot.betCloseTime !== input.betCloseTime ||
    input.snapshot.combatPolicyVersion !==
      (snapshotVersion === 3
        ? "duel-combat-policy-v2"
        : "duel-combat-policy-v1") ||
    !Array.isArray(input.snapshot.contestants) ||
    input.snapshot.contestants.length !== 2 ||
    !isCompetitiveContestant(
      input.snapshot.contestants[0],
      snapshotVersion,
      "agent1",
      input.agent1,
    ) ||
    !isCompetitiveContestant(
      input.snapshot.contestants[1],
      snapshotVersion,
      "agent2",
      input.agent2,
    )
  ) {
    return null;
  }
  const calculated = createHash("sha256")
    .update(canonicalJson(input.snapshot))
    .digest("hex");
  return calculated === input.digest
    ? (input.snapshot as CompetitiveSnapshot)
    : null;
}

export function normalizeBettingFeedCycle(
  payload: BettingFeedStateUpdate,
): StreamingCycle | null {
  if (!isRecord(payload) || !hasExactKeys(payload, BETTING_FEED_KEYS)) {
    return null;
  }
  const phaseIsValid =
    payload.phase === null ||
    (typeof payload.phase === "string" &&
      BETTING_FEED_PHASES.has(payload.phase));
  const outcomeIsValid =
    payload.outcome === null ||
    payload.outcome === "win" ||
    payload.outcome === "draw" ||
    payload.outcome === "cancelled";
  const duelIdIsValid =
    payload.duelId === null ||
    (typeof payload.duelId === "string" && payload.duelId.trim().length > 0);
  const duelKeyIsValid =
    payload.duelKey === null ||
    (typeof payload.duelKey === "string" &&
      /^[0-9a-f]{64}$/.test(payload.duelKey));
  const seedIsValid = payload.seed === null || isUint64Decimal(payload.seed);
  const replayHashIsValid =
    payload.replayHash === null ||
    (typeof payload.replayHash === "string" &&
      /^[0-9a-f]{64}$/.test(payload.replayHash));
  const winReasonIsValid =
    payload.winReason === null ||
    payload.winReason === "kill" ||
    payload.winReason === "forfeit" ||
    payload.winReason === "hp_advantage" ||
    payload.winReason === "damage_advantage" ||
    payload.winReason === "draw";
  const hasActiveIdentity =
    payload.duelId !== null &&
    payload.duelKey !== null &&
    payload.phase !== null &&
    payload.agent1 !== null &&
    payload.agent2 !== null;
  const hasIdleIdentity =
    payload.duelId === null &&
    payload.duelKey === null &&
    payload.phase === null &&
    payload.agent1 === null &&
    payload.agent2 === null;
  const canonicalAgent1 = isCanonicalAgent(payload.agent1)
    ? payload.agent1
    : null;
  const canonicalAgent2 = isCanonicalAgent(payload.agent2)
    ? payload.agent2
    : null;
  const winnerNameIsValid =
    payload.winnerId === null
      ? payload.winnerName === null
      : canonicalAgent1 && payload.winnerId === canonicalAgent1.id
        ? payload.winnerName === canonicalAgent1.name
        : canonicalAgent2 && payload.winnerId === canonicalAgent2.id
          ? payload.winnerName === canonicalAgent2.name
          : false;
  const terminalShapeIsValid =
    payload.outcome === "win"
      ? payload.phase === "RESOLUTION" &&
        isNullableNonemptyString(payload.winnerId) &&
        payload.winnerId !== null &&
        (payload.winnerId === canonicalAgent1?.id ||
          payload.winnerId === canonicalAgent2?.id) &&
        payload.cancellationReason === null &&
        payload.winReason !== null &&
        payload.winReason !== "draw" &&
        payload.duelEndTime !== null &&
        payload.seed !== null &&
        payload.replayHash !== null
      : payload.outcome === "draw"
        ? payload.phase === "RESOLUTION" &&
          payload.winnerId === null &&
          payload.cancellationReason === "draw" &&
          payload.winReason === "draw" &&
          payload.duelEndTime !== null &&
          payload.seed !== null &&
          payload.replayHash !== null
        : payload.outcome === "cancelled"
          ? payload.winnerId === null &&
            isNullableNonemptyString(payload.cancellationReason) &&
            payload.cancellationReason !== null &&
            CANCELLATION_REASON.test(payload.cancellationReason) &&
            payload.winReason === null &&
            payload.duelEndTime !== null &&
            payload.seed === null &&
            payload.replayHash === null
          : true;
  const competitiveSnapshot =
    typeof payload.duelId === "string" &&
    typeof payload.duelKey === "string" &&
    typeof payload.betOpenTime === "number" &&
    typeof payload.betCloseTime === "number" &&
    payload.agent1 !== null &&
    payload.agent1 !== undefined &&
    payload.agent2 !== null &&
    payload.agent2 !== undefined &&
    isCanonicalAgent(payload.agent1) &&
    isCanonicalAgent(payload.agent2)
      ? normalizeCompetitiveSnapshot({
          snapshot: payload.competitiveSnapshot,
          version: payload.competitiveSnapshotVersion,
          digest: payload.competitiveSnapshotDigest,
          duelId: payload.duelId,
          duelKey: payload.duelKey,
          betOpenTime: payload.betOpenTime,
          betCloseTime: payload.betCloseTime,
          agent1: payload.agent1,
          agent2: payload.agent2,
          allowLegacyTerminalCancellation:
            payload.outcome === "cancelled" && payload.duelEndTime !== null,
        })
      : null;
  const competitiveShapeIsValid = hasActiveIdentity
    ? competitiveSnapshot !== null &&
      typeof payload.betOpenTime === "number" &&
      typeof payload.betCloseTime === "number" &&
      payload.betOpenTime < payload.betCloseTime
    : payload.competitiveSnapshotVersion === null &&
      payload.competitiveSnapshotDigest === null &&
      payload.competitiveSnapshot === null;
  const timelineIsValid = hasActiveIdentity
    ? typeof payload.betOpenTime === "number" &&
      typeof payload.betCloseTime === "number" &&
      payload.betOpenTime < payload.betCloseTime &&
      payload.emittedAt !== undefined &&
      payload.emittedAt >= payload.betOpenTime &&
      (payload.fightStartTime === null ||
        (typeof payload.fightStartTime === "number" &&
          payload.fightStartTime >= payload.betCloseTime &&
          payload.fightStartTime <= payload.emittedAt)) &&
      (payload.duelEndTime === null ||
        (typeof payload.duelEndTime === "number" &&
          payload.duelEndTime >=
            (payload.fightStartTime ?? payload.betOpenTime) &&
          payload.duelEndTime <= payload.emittedAt))
    : payload.betOpenTime === null &&
      payload.betCloseTime === null &&
      payload.fightStartTime === null &&
      payload.duelEndTime === null &&
      payload.winnerId === null &&
      payload.outcome === null &&
      payload.cancellationReason === null &&
      payload.winReason === null &&
      payload.seed === null &&
      payload.replayHash === null;

  if (
    payload.schemaVersion !== 3 ||
    !Number.isSafeInteger(payload.sourceEpoch) ||
    Number(payload.sourceEpoch) < 0 ||
    !Number.isSafeInteger(payload.seq) ||
    Number(payload.seq) < 0 ||
    !Number.isSafeInteger(payload.emittedAt) ||
    Number(payload.emittedAt) <= 0 ||
    !Number.isSafeInteger(payload.phaseVersion) ||
    Number(payload.phaseVersion) < 0 ||
    !duelIdIsValid ||
    !duelKeyIsValid ||
    (payload.duelId === null) !== (payload.duelKey === null) ||
    (!hasActiveIdentity && !hasIdleIdentity) ||
    !phaseIsValid ||
    !isNullableSafeTimestamp(payload.betOpenTime) ||
    !isNullableSafeTimestamp(payload.betCloseTime) ||
    !isNullableSafeTimestamp(payload.fightStartTime) ||
    !isNullableSafeTimestamp(payload.duelEndTime) ||
    !isNullableNonemptyString(payload.winnerId) ||
    !outcomeIsValid ||
    !isNullableNonemptyString(payload.cancellationReason) ||
    !winReasonIsValid ||
    !seedIsValid ||
    !replayHashIsValid ||
    !isCanonicalAgent(payload.agent1) ||
    !isCanonicalAgent(payload.agent2) ||
    !isArenaPositions(
      payload.arenaPositions,
      hasActiveIdentity,
      payload.outcome === "cancelled" && payload.duelEndTime !== null,
    ) ||
    !winnerNameIsValid ||
    !isRendererHealth(payload.rendererHealth) ||
    !competitiveShapeIsValid ||
    !timelineIsValid ||
    !terminalShapeIsValid
  ) {
    return null;
  }

  return {
    sourceEpoch: Number(payload.sourceEpoch),
    seq: Number(payload.seq),
    emittedAt: Number(payload.emittedAt),
    phaseVersion: Number(payload.phaseVersion),
    cycleId:
      competitiveSnapshot?.cycleId ??
      `bet-sync-${payload.sourceEpoch}-${payload.seq}`,
    phase: typeof payload.phase === "string" ? payload.phase : "IDLE",
    duelId: payload.duelId ?? null,
    duelKeyHex: payload.duelKey ?? null,
    competitiveSnapshotVersion: payload.competitiveSnapshotVersion ?? null,
    competitiveSnapshotDigest: payload.competitiveSnapshotDigest ?? null,
    competitiveSnapshot,
    betOpenTime: payload.betOpenTime ?? null,
    betCloseTime: payload.betCloseTime ?? null,
    fightStartTime: payload.fightStartTime ?? null,
    duelEndTime: payload.duelEndTime ?? null,
    winnerId: payload.winnerId ?? null,
    outcome: payload.outcome ?? null,
    cancellationReason: payload.cancellationReason ?? null,
    winReason: payload.winReason ?? null,
    seed: payload.seed ?? null,
    replayHash: payload.replayHash ?? null,
    agent1: payload.agent1 ?? null,
    agent2: payload.agent2 ?? null,
  };
}

function parseSsePayload(frame: string): {
  eventName: string;
  payload: BettingFeedStateUpdate;
} | null {
  let eventName = "message";
  const data: string[] = [];
  for (const line of frame.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (eventName === "heartbeat" || data.length === 0) return null;
  try {
    return {
      eventName,
      payload: JSON.parse(data.join("\n")) as BettingFeedStateUpdate,
    };
  } catch {
    throw new BettingFeedContinuityError(
      "betting feed replay returned invalid JSON",
    );
  }
}

export class GameClient {
  private url: string;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private onDuelStartCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private onBettingLockedCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private onDuelEndCb:
    | ((data: DuelLifecycleEvent) => void | Promise<void>)
    | null = null;
  private onStateFrameCb:
    | ((data: StreamingCycle) => void | Promise<void>)
    | null = null;
  private pollInFlight = false;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly betSyncToken: string;
  private readonly checkpointStore: BettingFeedCheckpointStore | null;
  private checkpoint: BettingFeedCheckpoint | null;
  private readonly activeControllers = new Set<AbortController>();
  private runtimeBootstrapped = false;
  private pollBackoffUntil = 0;
  private consecutivePollFailures = 0;

  private lastCycleId: string | null = null;
  private lastPhase: string | null = null;
  private lastLockedCycleId: string | null = null;
  private lastResolutionEventKey: string | null = null;

  constructor(url: string, checkpointStore?: BettingFeedCheckpointStore) {
    this.url = url.replace(/\/$/, "");
    this.checkpointStore = checkpointStore ?? null;
    this.checkpoint = this.checkpointStore?.getBettingFeedCheckpoint() ?? null;
    this.betSyncToken = process.env.BET_SYNC_SOURCE_BEARER_TOKEN?.trim() || "";
    const configuredTimeout = Number(process.env.GAME_STATE_POLL_TIMEOUT_MS);
    this.pollTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 1500;
    const configuredInterval = Number(process.env.GAME_STATE_POLL_INTERVAL_MS);
    this.pollIntervalMs =
      Number.isFinite(configuredInterval) && configuredInterval >= 1_000
        ? configuredInterval
        : 2_000;
  }

  public connect() {
    console.log(
      `[GameClient] Connected via HTTP polling to ${this.url} (interval=${this.pollIntervalMs}ms timeout=${this.pollTimeoutMs}ms)`,
    );
    this.pollInterval = setInterval(
      () => void this.poll(),
      this.pollIntervalMs,
    );
    void this.poll();
  }

  private registerPollFailure(reason: string) {
    this.consecutivePollFailures += 1;
    const backoffStep = Math.min(this.consecutivePollFailures, 5);
    const backoffMs = Math.min(30_000, this.pollIntervalMs * 2 ** backoffStep);
    this.pollBackoffUntil = Date.now() + backoffMs;

    if (
      this.consecutivePollFailures === 1 ||
      this.consecutivePollFailures % 10 === 0
    ) {
      console.warn(
        `[GameClient] streaming poll failed (${reason}); backing off ${backoffMs}ms (consecutive=${this.consecutivePollFailures})`,
      );
    }
  }

  private resetPollFailures() {
    this.consecutivePollFailures = 0;
    this.pollBackoffUntil = 0;
  }

  private isLockedPhase(phase: string | null): boolean {
    return (
      phase === "COUNTDOWN" || phase === "FIGHTING" || phase === "RESOLUTION"
    );
  }

  private isLockBoundaryReached(cycle: StreamingCycle): boolean {
    return (
      this.isLockedPhase(cycle.phase) ||
      (cycle.phase === "ANNOUNCEMENT" &&
        cycle.betCloseTime !== null &&
        cycle.emittedAt >= cycle.betCloseTime)
    );
  }

  private isTerminalEvent(event: DuelLifecycleEvent): boolean {
    return (
      event.outcome === "win" ||
      event.outcome === "draw" ||
      event.outcome === "cancelled"
    );
  }

  private isRefundTerminal(event: DuelLifecycleEvent): boolean {
    return event.outcome === "draw" || event.outcome === "cancelled";
  }

  private resolutionEventKey(event: DuelLifecycleEvent): string {
    return [
      event.cycleId,
      event.outcome ?? "",
      event.cancellationReason ?? "",
      event.winnerId ?? "",
      event.seed ?? "",
      event.replayHash ?? "",
    ].join(":");
  }

  private async emitDuelStart(event: DuelLifecycleEvent) {
    if (this.onDuelStartCb) {
      await this.onDuelStartCb(event);
    }
  }

  private async emitBettingLocked(event: DuelLifecycleEvent) {
    if (!this.onBettingLockedCb || this.lastLockedCycleId === event.cycleId) {
      return;
    }
    await this.onBettingLockedCb(event);
    this.lastLockedCycleId = event.cycleId;
  }

  private async emitDuelEnd(event: DuelLifecycleEvent) {
    if (!this.onDuelEndCb) {
      return;
    }
    const nextEventKey = this.resolutionEventKey(event);
    if (this.lastResolutionEventKey === nextEventKey) {
      return;
    }
    await this.onDuelEndCb(event);
    this.lastResolutionEventKey = nextEventKey;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { connection: "close" };
    if (this.betSyncToken) {
      headers.authorization = `Bearer ${this.betSyncToken}`;
    }
    return headers;
  }

  private resetRuntimeLifecycle(): void {
    this.lastCycleId = null;
    this.lastPhase = null;
    this.lastLockedCycleId = null;
    this.lastResolutionEventKey = null;
  }

  private async applyLifecycleCycle(
    currentCycle: StreamingCycle,
  ): Promise<void> {
    const currentPhase = currentCycle.phase;
    const lifecycleEvent = normalizeLifecycleEvent(currentCycle);
    if (!lifecycleEvent) {
      this.resetRuntimeLifecycle();
      this.lastPhase = currentPhase;
      return;
    }

    if (currentCycle.cycleId !== this.lastCycleId) {
      this.lastLockedCycleId = null;
      this.lastResolutionEventKey = null;

      if (this.isRefundTerminal(lifecycleEvent)) {
        await this.emitDuelEnd(lifecycleEvent);
        this.lastCycleId = currentCycle.cycleId;
      } else {
        await this.emitDuelStart(lifecycleEvent);
        this.lastCycleId = currentCycle.cycleId;
        if (this.isLockBoundaryReached(currentCycle)) {
          await this.emitBettingLocked(lifecycleEvent);
        }
        if (this.isTerminalEvent(lifecycleEvent)) {
          await this.emitDuelEnd(lifecycleEvent);
        }
      }
      this.lastPhase = currentPhase;
      return;
    }

    if (this.isRefundTerminal(lifecycleEvent)) {
      await this.emitDuelEnd(lifecycleEvent);
      this.lastPhase = currentPhase;
      return;
    }
    if (this.isLockBoundaryReached(currentCycle)) {
      await this.emitBettingLocked(lifecycleEvent);
    }
    if (this.isTerminalEvent(lifecycleEvent)) {
      await this.emitDuelEnd(lifecycleEvent);
    }
    this.lastPhase = currentPhase;
  }

  private async emitStateFrame(currentCycle: StreamingCycle): Promise<void> {
    if (this.onStateFrameCb) {
      await this.onStateFrameCb(currentCycle);
    }
  }

  private checkpointForCycle(
    currentCycle: StreamingCycle,
  ): BettingFeedCheckpoint {
    const lifecycleEvent = normalizeLifecycleEvent(currentCycle);
    return {
      sourceEpoch: currentCycle.sourceEpoch,
      lastAppliedSeq: currentCycle.seq,
      lastEmittedAt: currentCycle.emittedAt,
      duelId: currentCycle.duelId,
      competitiveSnapshotDigest: currentCycle.competitiveSnapshotDigest,
      phase: currentCycle.phase,
      terminal: lifecycleEvent ? this.isTerminalEvent(lifecycleEvent) : true,
      degradedReason: null,
      updatedAt: Date.now(),
    };
  }

  private persistCycleCheckpoint(currentCycle: StreamingCycle): void {
    const next = this.checkpointForCycle(currentCycle);
    this.checkpoint = this.checkpointStore
      ? this.checkpointStore.saveBettingFeedCheckpoint(next)
      : next;
  }

  private validateSourceEpoch(currentCycle: StreamingCycle): void {
    const checkpoint = this.checkpoint;
    if (!checkpoint || currentCycle.sourceEpoch === checkpoint.sourceEpoch) {
      return;
    }
    if (currentCycle.sourceEpoch < checkpoint.sourceEpoch) {
      throw new BettingFeedContinuityError(
        `betting feed source epoch regressed from ${checkpoint.sourceEpoch} to ${currentCycle.sourceEpoch}`,
      );
    }
    if (currentCycle.emittedAt + 1_000 < checkpoint.lastEmittedAt) {
      throw new BettingFeedContinuityError(
        "betting feed source epoch reset to materially stale state",
      );
    }
    const sameDuel =
      checkpoint.duelId !== null && checkpoint.duelId === currentCycle.duelId;
    if (
      sameDuel &&
      checkpoint.competitiveSnapshotDigest !==
        currentCycle.competitiveSnapshotDigest
    ) {
      throw new BettingFeedContinuityError(
        `competitive snapshot changed across source epoch for duel ${checkpoint.duelId}`,
      );
    }
    if (!checkpoint.terminal && checkpoint.duelId !== null && !sameDuel) {
      throw new BettingFeedContinuityError(
        `betting feed source epoch changed before active duel ${checkpoint.duelId} reached a terminal state`,
      );
    }
    this.resetRuntimeLifecycle();
    this.runtimeBootstrapped = false;
  }

  private async processCycle(
    currentCycle: StreamingCycle,
    allowReplay: boolean,
  ): Promise<void> {
    this.validateSourceEpoch(currentCycle);
    const checkpoint = this.checkpoint;
    if (checkpoint && currentCycle.sourceEpoch === checkpoint.sourceEpoch) {
      if (
        checkpoint.duelId !== null &&
        checkpoint.duelId === currentCycle.duelId &&
        checkpoint.competitiveSnapshotDigest !==
          currentCycle.competitiveSnapshotDigest
      ) {
        throw new BettingFeedContinuityError(
          `competitive snapshot changed for active duel ${checkpoint.duelId}`,
        );
      }
      if (currentCycle.seq < checkpoint.lastAppliedSeq) {
        throw new BettingFeedContinuityError(
          `betting feed sequence regressed from ${checkpoint.lastAppliedSeq} to ${currentCycle.seq}`,
        );
      }
      if (
        currentCycle.seq === checkpoint.lastAppliedSeq &&
        this.runtimeBootstrapped
      ) {
        return;
      }
      if (
        currentCycle.seq > checkpoint.lastAppliedSeq &&
        currentCycle.emittedAt < checkpoint.lastEmittedAt
      ) {
        throw new BettingFeedContinuityError(
          `betting feed emittedAt regressed at sequence ${currentCycle.seq}`,
        );
      }
      if (currentCycle.seq > checkpoint.lastAppliedSeq + 1) {
        if (!allowReplay) {
          throw new BettingFeedContinuityError(
            `betting feed replay remained gapped at ${checkpoint.lastAppliedSeq} -> ${currentCycle.seq}`,
          );
        }
        await this.replayThrough(currentCycle);
        return;
      }
    }

    await this.emitStateFrame(currentCycle);
    await this.applyLifecycleCycle(currentCycle);
    this.persistCycleCheckpoint(currentCycle);
    this.runtimeBootstrapped = true;
  }

  private async replayThrough(targetCycle: StreamingCycle): Promise<void> {
    const checkpoint = this.checkpoint;
    if (!checkpoint) {
      throw new BettingFeedContinuityError(
        "betting feed replay requested without a durable checkpoint",
      );
    }
    const url = new URL(`${this.url}/api/internal/bet-sync/events`);
    url.searchParams.set("since", String(checkpoint.lastAppliedSeq));
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const replayTimeoutMs = Math.max(10_000, this.pollTimeoutMs * 4);
    const timeoutId = setTimeout(() => controller.abort(), replayTimeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: this.buildHeaders(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`betting feed replay failed (HTTP ${response.status})`);
      }

      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder
          .decode(chunk, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const rawFrame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          if (!rawFrame.trim() || rawFrame.startsWith(":")) continue;
          const message = parseSsePayload(rawFrame);
          if (!message) continue;
          if (message.eventName === "reset") {
            throw new BettingFeedContinuityError(
              `betting feed replay gap exceeded source retention after sequence ${checkpoint.lastAppliedSeq}`,
            );
          }
          const replayCycle = normalizeBettingFeedCycle(message.payload);
          if (!replayCycle) {
            throw new BettingFeedContinuityError(
              "betting feed replay contained an invalid schema-v3 frame",
            );
          }
          if (replayCycle.sourceEpoch !== targetCycle.sourceEpoch) {
            throw new BettingFeedContinuityError(
              "betting feed source epoch changed during replay",
            );
          }
          await this.processCycle(replayCycle, false);
          if ((this.checkpoint?.lastAppliedSeq ?? 0) >= targetCycle.seq) {
            return;
          }
        }
      }
      throw new Error(
        `betting feed replay ended before sequence ${targetCycle.seq}`,
      );
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
      this.activeControllers.delete(controller);
    }
  }

  private async poll() {
    if (Date.now() < this.pollBackoffUntil || this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), this.pollTimeoutMs);

    try {
      const res = await fetch(`${this.url}/api/internal/bet-sync/state`, {
        cache: "no-store",
        headers: this.buildHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // Ignore cancellation issues when the transport is already closed.
        }
        this.registerPollFailure(`HTTP ${res.status}`);
        return;
      }

      const data = (await res.json()) as BettingFeedStateUpdate;
      const currentCycle = normalizeBettingFeedCycle(data);
      if (!currentCycle) {
        throw new BettingFeedContinuityError(
          "betting feed state was not a valid schema-v3 frame",
        );
      }
      await this.processCycle(currentCycle, true);
      this.resetPollFailures();
    } catch (err) {
      if (err instanceof BettingFeedContinuityError) {
        this.checkpointStore?.markBettingFeedDegraded(err);
        this.checkpoint =
          this.checkpointStore?.getBettingFeedCheckpoint() ?? this.checkpoint;
      }
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? `timeout after ${this.pollTimeoutMs}ms`
            : err.message
          : "request failed";
      this.registerPollFailure(message);
    } finally {
      clearTimeout(timeoutId);
      this.activeControllers.delete(controller);
      this.pollInFlight = false;
    }
  }

  public onDuelStart(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onDuelStartCb = callback;
  }

  public onStateFrame(
    callback: (data: StreamingCycle) => void | Promise<void>,
  ) {
    this.onStateFrameCb = callback;
  }

  public onBettingLocked(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onBettingLockedCb = callback;
  }

  public onDuelEnd(
    callback: (data: DuelLifecycleEvent) => void | Promise<void>,
  ) {
    this.onDuelEndCb = callback;
  }

  public disconnect() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }
}
