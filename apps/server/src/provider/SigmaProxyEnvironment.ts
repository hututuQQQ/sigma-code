const PROXY_ENV_NAMES = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

const LOCAL_PROXY_BYPASS_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;
const DESKTOP_SYSTEM_PROXY_ENV = "SIGMACODE_SYSTEM_PROXY_URL";

function supportedProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function firstSupportedProxy(
  environment: NodeJS.ProcessEnv,
  names: ReadonlyArray<(typeof PROXY_ENV_NAMES)[number]>,
): string | undefined {
  for (const name of names) {
    const value = supportedProxyUrl(environment[name]);
    if (value) return value;
  }
  return undefined;
}

function mergeNoProxy(environment: NodeJS.ProcessEnv): string {
  const entries = (environment.NO_PROXY ?? environment.no_proxy ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const host of LOCAL_PROXY_BYPASS_HOSTS) {
    if (seen.has(host)) continue;
    entries.push(host);
    seen.add(host);
  }
  return entries.join(",");
}

/**
 * Node's built-in environment proxy support parses every configured proxy URL
 * during startup. One malformed value can therefore disable an otherwise valid
 * HTTPS proxy before Sigma reaches the ChatGPT token endpoint.
 */
export function resolveSigmaProcessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...environment };
  const desktopSystemProxy = supportedProxyUrl(environment[DESKTOP_SYSTEM_PROXY_ENV]);
  const allProxy =
    firstSupportedProxy(environment, ["ALL_PROXY", "all_proxy"]) ?? desktopSystemProxy;
  const httpsProxy = firstSupportedProxy(environment, ["HTTPS_PROXY", "https_proxy"]) ?? allProxy;
  const httpProxy =
    firstSupportedProxy(environment, ["HTTP_PROXY", "http_proxy"]) ?? allProxy ?? httpsProxy;

  for (const name of PROXY_ENV_NAMES) {
    delete next[name];
  }
  delete next.NO_PROXY;
  delete next.no_proxy;

  if (httpProxy) next.HTTP_PROXY = httpProxy;
  if (httpsProxy ?? httpProxy) next.HTTPS_PROXY = httpsProxy ?? httpProxy;
  next.NO_PROXY = mergeNoProxy(environment);
  next.NODE_USE_ENV_PROXY = "1";
  return next;
}
