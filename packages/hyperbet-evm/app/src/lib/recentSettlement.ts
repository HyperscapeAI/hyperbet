export function getRecentSettlementTitle(params: {
  duel:
    | {
        winner: "A" | "B" | "NONE";
        phase: string | null;
        agent1Name: string | null;
        agent2Name: string | null;
      }
    | null
    | undefined;
  fallbackLabel: string;
  idleLabel: string;
}): string {
  if (params.duel?.winner === "A" && params.duel.agent1Name) {
    return params.duel.agent1Name;
  }
  if (params.duel?.winner === "B" && params.duel.agent2Name) {
    return params.duel.agent2Name;
  }
  if (params.duel?.winner === "A" || params.duel?.winner === "B") {
    return params.fallbackLabel;
  }
  return params.duel?.phase ?? params.idleLabel;
}
