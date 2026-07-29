export const DISTRIBUTION_LEGAL_RESOURCES = [
  { sourceRelativePath: "LICENSE", targetFileName: "LICENSE" },
  { sourceRelativePath: "NOTICE", targetFileName: "NOTICE" },
  {
    sourceRelativePath: "THIRD_PARTY_NOTICES.md",
    targetFileName: "THIRD_PARTY_NOTICES.md",
  },
  {
    sourceRelativePath: "apps/web/THIRD_PARTY_NOTICES.md",
    targetFileName: "THIRD_PARTY_NOTICES.web.md",
  },
  {
    sourceRelativePath: "apps/mobile/modules/t3-terminal/THIRD_PARTY_NOTICES.md",
    targetFileName: "THIRD_PARTY_NOTICES.mobile-terminal.md",
  },
  {
    sourceRelativePath: "apps/mobile/modules/t3-terminal/Vendor/libghostty-vt/LICENSE",
    targetFileName: "LICENSE.ghostty",
  },
] as const;
