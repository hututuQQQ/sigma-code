import { afterEach, describe, expect, it, vi } from "vite-plus/test";

describe("legal-document-url", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exposes no remote legal URL in an unconfigured build", async () => {
    const legal = await import("./legal-document-url");

    expect(legal.LEGAL_URL).toBeNull();
    expect(legal.ALLOWED_LEGAL_DOCUMENT_URLS).toEqual([]);
    expect(legal.isLegalDocumentUrl("https://t3.codes/legal")).toBe(false);
  });

  it("allows only documents under an explicitly configured Sigma-owned origin", async () => {
    vi.stubEnv("EXPO_PUBLIC_SIGMACODE_MARKETING_SITE_URL", "https://legal.sigma-code.example/base");
    const legal = await import("./legal-document-url");

    expect(legal.LEGAL_URL).toBe("https://legal.sigma-code.example/base/legal");
    expect(legal.isLegalDocumentUrl("https://legal.sigma-code.example/base/legal/")).toBe(true);
    expect(
      legal.isLegalDocumentUrl("https://legal.sigma-code.example/base/privacy-policy?source=app"),
    ).toBe(true);
    expect(legal.isLegalDocumentUrl("https://t3.codes/legal")).toBe(false);
    expect(legal.isLegalDocumentUrl("javascript:alert(1)")).toBe(false);
  });
});
