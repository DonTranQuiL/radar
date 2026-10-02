export const PARTY_FILL: Record<string, string> = {
  "PVV (Partij voor de Vrijheid)": "var(--color-party-pvv)",
  D66: "var(--color-party-d66)",
  VVD: "var(--color-party-vvd)",
  "GROENLINKS / Partij van de Arbeid (PvdA)": "var(--color-party-gl)",
  CDA: "var(--color-party-cda)",
  "Nieuw Sociaal Contract (NSC)": "var(--color-party-nsc)",
  "SP (Socialistische Partij)": "var(--color-party-sp)",
  BBB: "var(--color-party-bbb)",
  DENK: "var(--color-party-denk)",
  JA21: "var(--color-party-ja21)",
};

export const PARTY_SHORT: Record<string, string> = {
  "PVV (Partij voor de Vrijheid)": "PVV",
  D66: "D66",
  VVD: "VVD",
  "GROENLINKS / Partij van de Arbeid (PvdA)": "GL-PvdA",
  CDA: "CDA",
  "Nieuw Sociaal Contract (NSC)": "NSC",
  "SP (Socialistische Partij)": "SP",
  BBB: "BBB",
  DENK: "DENK",
  JA21: "JA21",
};

export function partyFill(name: string) {
  return PARTY_FILL[name] ?? "var(--color-party-other)";
}

export function partyShort(name: string) {
  return PARTY_SHORT[name] ?? name;
}
