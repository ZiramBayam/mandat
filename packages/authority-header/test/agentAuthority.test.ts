import { describe, expect, it } from "vitest";
import { buildS5Prompt, parseAgentDecision } from "../src/agent/authority.js";

/**
 * The parser is the only part of S5 that can fail silently.
 *
 * If it accepted a tier name outside the catalogue, a run would still "pass" while
 * proving nothing -- the amount would be looked up against a different table than
 * the model saw, or not looked up at all. So it refuses rather than guessing.
 */
describe("parseAgentDecision", () => {
  const allowed = ["cheap-dataset", "expensive-dataset"];

  it("reads a bare JSON object", () => {
    const d = parseAgentDecision('{"tier":"cheap-dataset","reasoning":"my cap is 0.5"}', allowed);
    expect(d.tier).toBe("cheap-dataset");
    expect(d.reasoning).toBe("my cap is 0.5");
  });

  it("reads JSON out of a fenced code block", () => {
    const d = parseAgentDecision('```json\n{"tier":"cheap-dataset","reasoning":"x"}\n```', allowed);
    expect(d.tier).toBe("cheap-dataset");
  });

  it("reads JSON embedded in prose", () => {
    const d = parseAgentDecision('I will buy this. {"tier":"cheap-dataset","reasoning":"budget"} Done.', allowed);
    expect(d.tier).toBe("cheap-dataset");
  });

  it("refuses a tier the agent was never offered", () => {
    expect(() => parseAgentDecision('{"tier":"unlimited-dataset"}', allowed)).toThrow(/not one of/);
  });

  it("refuses non-JSON rather than guessing at intent", () => {
    expect(() => parseAgentDecision("I think I should buy the cheap one.", allowed)).toThrow(/did not return JSON/);
  });

  it("refuses a missing tier field", () => {
    expect(() => parseAgentDecision('{"reasoning":"no choice"}', allowed)).toThrow(/no tier name/);
  });

  it("tolerates a missing reasoning without failing the run", () => {
    const d = parseAgentDecision('{"tier":"cheap-dataset"}', allowed);
    expect(d.tier).toBe("cheap-dataset");
    expect(d.reasoning).toBe("");
  });
});

describe("buildS5Prompt", () => {
  it("offers exactly the catalogue names and nothing else", () => {
    const prompt = buildS5Prompt([{ name: "cheap-dataset" }, { name: "expensive-dataset" }]);
    expect(prompt).toContain("cheap-dataset, expensive-dataset");
  });

  it("does not leak a price or a cap into the prompt", () => {
    // The downgrade has to come from get_my_authority(). If a price appeared here
    // the model could compare against it without ever reading its own budget,
    // and the recording would not show what it claims to show.
    const prompt = buildS5Prompt([{ name: "cheap-dataset" }, { name: "expensive-dataset" }]);
    expect(prompt).not.toMatch(/0\.1|0\.8|500000000000000000|800000000000000000/);
  });

  it("asks for the premium resource, so a downgrade is a real decision", () => {
    expect(buildS5Prompt([{ name: "cheap-dataset" }])).toContain("buy the premium dataset");
  });
});