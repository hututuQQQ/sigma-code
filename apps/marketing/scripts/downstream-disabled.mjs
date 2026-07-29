const operation = process.argv[2] ?? "run";
const message =
  "The upstream T3 marketing site is retained as MIT-licensed reference source, " +
  "but is not a Sigma Code product surface and has no configured deployment.";

if (operation === "build") {
  console.log(`[sigma-code] ${message} Skipping the marketing build.`);
} else {
  console.error(`[sigma-code] ${message}`);
  process.exitCode = 1;
}
