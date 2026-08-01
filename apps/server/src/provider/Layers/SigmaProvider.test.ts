import { describe, expect, it } from "vite-plus/test";

import { sigmaSkillsFromCapabilities } from "./SigmaProvider.ts";

describe("SigmaProvider capabilities", () => {
  it("maps Sigma ACP skills and prefers a workspace skill with the same name", () => {
    expect(
      sigmaSkillsFromCapabilities({
        skills: [
          {
            name: "review",
            qualifiedName: "home:review",
            description: "Home review skill",
            source: "home",
            path: "/home/.sigma/skills/review/SKILL.md",
          },
          {
            name: "review",
            qualifiedName: "workspace:review",
            description: "Workspace review skill",
            source: "workspace",
            path: "/repo/.agent/skills/review/SKILL.md",
          },
        ],
        slashCommands: [],
      }),
    ).toEqual([
      {
        name: "review",
        description: "Workspace review skill",
        shortDescription: "Workspace review skill",
        path: "/repo/.agent/skills/review/SKILL.md",
        scope: "workspace",
        enabled: true,
      },
    ]);
  });

  it("ignores malformed ACP skill entries", () => {
    expect(sigmaSkillsFromCapabilities({ skills: [{ name: "missing-path" }, null] })).toEqual([]);
  });
});
