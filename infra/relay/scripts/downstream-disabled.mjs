const operation = process.argv[2] ?? "operate";

console.error(
  `Sigma Code relay ${operation} is disabled until Sigma-owned Clerk, Cloudflare, ` +
    "DNS, telemetry, and release configuration is committed.",
);
process.exitCode = 1;
