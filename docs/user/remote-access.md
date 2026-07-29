# Remote access

Sigma Code supports direct local, LAN, tailnet, and SSH connections. A fresh
checkout does not use T3 Connect, `app.t3.codes`, or a T3 relay.

## Local and LAN

Start the local server and open the one-time pairing URL printed to stderr:

```sh
sigma-code serve
```

To bind a reachable interface explicitly:

```sh
sigma-code serve --host 0.0.0.0
```

Only expose a backend on a trusted network. Pairing authorizes a client but does
not turn an untrusted network into a safe one.

## Tailnet

Source development can publish its web origin through the host's existing
Tailscale setup:

```sh
vp run dev --share
```

The startup output is authoritative for the shared origin and pairing URL.
There is no downstream hosted web router fallback.

## SSH

The desktop SSH launcher stores its remote launcher state under
`~/.sigma/code/ssh-launch/<host-key>/` and starts `sigma-code` on the remote
host. The host must have a compatible Node.js runtime and one of:

1. a `sigma-code` executable already on `PATH`;
2. an explicitly configured local server entry point; or
3. a Sigma-owned package configured with `SIGMACODE_SERVER_NPM_PACKAGE`.

If none is available, launch fails with an actionable message. It never
installs `t3@latest`.

Use the connection settings in Sigma Code to add or remove saved direct and SSH
environments. All connection metadata stays in the Sigma Code state directory.
