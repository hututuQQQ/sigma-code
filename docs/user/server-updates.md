# Keeping Sigma Code clients and servers in sync

The web or desktop client and the server should use the same Sigma Code version.
Version mismatch warnings remain available, and every update path fails closed
unless Sigma-owned release metadata is present.

- Official Windows installers read desktop updates only from
  `hututuQQQ/sigma` Releases. Source and locally built artifacts remain disabled
  unless `SIGMACODE_DESKTOP_UPDATE_REPOSITORY` is set at build time.
- Server self-update is disabled unless
  `SIGMACODE_SERVER_NPM_PACKAGE` names a Sigma-owned package.
- No update path falls back to the T3 Code GitHub repository, npm package, or
  signing configuration.

For a source checkout, stop active work, update this repository through the
documented stable-upstream process, rebuild both client and server, and restart
them with the same version. For an installed Linux service, install the desired
Sigma Code CLI locally and run:

```sh
sigma-code service update
```

See [Synchronizing T3 Code](../upstream-sync.md) for maintainer import steps and
[Running Sigma Code in the background](./background-service.md) for service
management.
