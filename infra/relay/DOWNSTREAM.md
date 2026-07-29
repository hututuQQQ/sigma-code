# Sigma Code relay boundary

The relay source is retained to make future upstream synchronization reviewable,
but a fresh Sigma Code checkout cannot deploy or destroy relay infrastructure.
The `deploy` and `destroy` package scripts fail closed.

Before enabling either command, maintainers must replace every T3-owned Clerk,
Cloudflare, DNS, telemetry, signing, and release value with Sigma-owned
configuration and add deployment tests. Until then, Sigma Code hides cloud
features and uses only local connections.
