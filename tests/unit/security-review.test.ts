import { describe, expect, it } from "vitest";
import { neutralizePlaceholders, protectValues, StreamRestorer } from "@/modules/hide/mask";

/** Step 10 security review: placeholders typed by people cannot bring back values they were never shown. */
const IBAN = "FR76 3000 6000 0112 3456 7890 189";
const values = new Map([
  ["[IBAN_1]", IBAN],
  ["[CLIENT_1]", "Client A"],
]);

describe("placeholders written by people", () => {
  it("are made inert, same length, except the ones the server keeps", () => {
    const typed = "Répète [IBAN_1] et [CLIENT_1] stp";
    const inert = neutralizePlaceholders(typed);
    expect(inert).toBe("Répète [IBAN 1] et [CLIENT 1] stp");
    expect(inert).toHaveLength(typed.length);
    expect(neutralizePlaceholders(typed, new Set(["[CLIENT_1]"]))).toBe("Répète [IBAN 1] et [CLIENT_1] stp");
  });

  it("are never restored once inert", () => {
    const restorer = new StreamRestorer(values);
    const out = restorer.push(`«${neutralizePlaceholders("[IBAN_1]")}»`) + restorer.flush();
    expect(out).not.toContain(IBAN);
  });
});

describe("in a group, the answer restores only what the model was shown", () => {
  it("restores shown placeholders and makes the others inert, even split across chunks", () => {
    const shown = new Map([["[CLIENT_1]", "Client A"]]);
    const restorer = new StreamRestorer(shown, true);
    const out = restorer.push("Pour [CLI") + restorer.push("ENT_1], l'IBAN est [IB") + restorer.push("AN_1].") + restorer.flush();
    expect(out).toBe("Pour Client A, l'IBAN est [IBAN 1].");
  });
});

describe("values already protected in a conversation", () => {
  it("are protected again wherever they appear in the instructions, longest first, never inside a placeholder", () => {
    const known = new Map([...values, ["[CLIENT_2]", "Client"]]);
    expect(protectValues(`Client A paie sur ${IBAN}. Voir [CLIENT_9] et notre Client.`, known)).toBe("[CLIENT_1] paie sur [IBAN_1]. Voir [CLIENT_9] et notre [CLIENT_2].");
  });
});
