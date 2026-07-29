# Running Sigma Code in the background

On Linux with systemd, an installed Sigma Code CLI can run as a per-user
background service. The service uses the `sigmacode.service` unit and
`~/.sigma/code`; it does not reuse T3 Code's service or state.

```sh
sigma-code service install
sigma-code service status
sigma-code service update
sigma-code service uninstall
```

`service update` uses the exact locally installed Sigma Code CLI. It does not
download `t3` or another package implicitly.

Automatic installation of a matching remote server is fail-closed. Maintainers
must first publish a Sigma-owned package and set
`SIGMACODE_SERVER_NPM_PACKAGE` to that package name. Without this setting,
Sigma Code asks the operator to install the local Sigma Code CLI on the host.

Updating or removing the service briefly stops the server. Let active agent and
terminal work finish first.
