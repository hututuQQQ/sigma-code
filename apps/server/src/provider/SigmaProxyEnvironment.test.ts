import { describe, expect, it } from "@effect/vitest";

import { resolveSigmaProcessEnvironment } from "./SigmaProxyEnvironment.ts";

describe("resolveSigmaProcessEnvironment", () => {
  it("drops a malformed HTTP proxy and reuses the valid HTTPS proxy", () => {
    const resolved = resolveSigmaProcessEnvironment({
      HTTP_PROXY: "htpp://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    });

    expect(resolved.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(resolved.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(resolved.NODE_USE_ENV_PROXY).toBe("1");
  });

  it("normalizes lowercase proxy variables and preserves unrelated environment", () => {
    const resolved = resolveSigmaProcessEnvironment({
      Path: "C:\\tools",
      http_proxy: "http://127.0.0.1:8080",
      https_proxy: "https://proxy.example.test:8443",
    });

    expect(resolved.Path).toBe("C:\\tools");
    expect(resolved.HTTP_PROXY).toBe("http://127.0.0.1:8080");
    expect(resolved.HTTPS_PROXY).toBe("https://proxy.example.test:8443");
    expect(resolved.http_proxy).toBeUndefined();
    expect(resolved.https_proxy).toBeUndefined();
  });

  it("always bypasses the proxy for the local OAuth callback", () => {
    const resolved = resolveSigmaProcessEnvironment({
      NO_PROXY: "internal.example.test,LOCALHOST",
    });

    expect(resolved.NO_PROXY?.split(",")).toEqual([
      "internal.example.test",
      "LOCALHOST",
      "127.0.0.1",
      "::1",
    ]);
  });

  it("enables proxy support without inventing a remote proxy", () => {
    const resolved = resolveSigmaProcessEnvironment({});

    expect(resolved.HTTP_PROXY).toBeUndefined();
    expect(resolved.HTTPS_PROXY).toBeUndefined();
    expect(resolved.NODE_USE_ENV_PROXY).toBe("1");
    expect(resolved.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });

  it("uses the desktop-resolved system proxy when no explicit proxy is configured", () => {
    const resolved = resolveSigmaProcessEnvironment({
      SIGMACODE_SYSTEM_PROXY_URL: "http://127.0.0.1:7890",
    });

    expect(resolved.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(resolved.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
  });
});
