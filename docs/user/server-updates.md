# Keeping Sigma Code clients and servers in sync

The web or desktop client and the server should use the same Sigma Code version.
Version mismatch warnings remain available, but downstream updates fail closed
until Sigma-owned release infrastructure exists.

- Desktop automatic updates are disabled unless the packaged application
  contains Sigma-owned update metadata.
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
