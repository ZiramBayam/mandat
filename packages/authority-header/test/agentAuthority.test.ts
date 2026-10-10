import { describe, expect, it } from "vitest";
import { buildS5Prompt, parseAgentDecision } from "../src/agent/authority.js";

const CATALOGUE = [
  { name: "cheap-dataset", price: 100_000_000_000_000_000n },
  { name: "expensive-dataset", price: 800_000_000_000_000_000n },
];

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
  it("quotes prices in base units, since that is what the cap is in too", () => {
    // The comparison has to be like-for-like. The cap arrives in base units from
    // the tool, so a price quoted in whole tokens would not be comparable to it
    // without arithmetic the prompt never asks for.
    const prompt = buildS5Prompt(CATALOGUE);
    expect(prompt).toContain("base units");
    expect(prompt).not.toMatch(/cheap-dataset: 0\.1/);
  });

  it("shows the catalogue with prices, so the agent can compare at all", () => {
    // Prices are public. An agent that cannot see them is guessing from a name
    // like "cheap-dataset" rather than deciding on economics.
    const prompt = buildS5Prompt(CATALOGUE);
    expect(prompt).toContain("cheap-dataset: 100000000000000000");
    expect(prompt).toContain("expensive-dataset: 800000000000000000");
  });

  it("never states the agent's budget, because that is the tool's job", () => {
    // The cap is the whole point of the demo. If a number appeared here the model
    // could compare without ever reading its own authority, and a downgrade would
    // prove nothing about the constraint binding.
    const prompt = buildS5Prompt(CATALOGUE);
    expect(prompt).not.toContain("500000000000000000");
    expect(prompt).not.toContain("my budget is");
    expect(prompt).not.toMatch(/cap of \d+/);
  });

  it("says the budget is enforced on chain, which is true and is the point", () => {
    expect(buildS5Prompt(CATALOGUE)).toContain("enforced on chain");
  });

  it("tells the agent to compare rather than merely to obey", () => {
    const prompt = buildS5Prompt(CATALOGUE);
    expect(prompt).toContain("Compare what you were asked for against what your budget allows");
    expect(prompt).toContain("buy the premium dataset");
  });

  it("tells the agent to read its authority before choosing", () => {
    expect(buildS5Prompt(CATALOGUE)).toContain("Call get_my_authority()");
  });
});