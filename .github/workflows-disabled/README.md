# Disabled downstream deployment workflows

These upstream workflows are intentionally outside `.github/workflows` and
cannot run. Sigma Code does not yet have a configured release repository,
relay deployment, EAS project, signing identity, or store application.

Before restoring any workflow, replace every upstream repository, service,
tenant, signing, EAS, and update-feed reference with reviewed Sigma-owned
configuration. Never enable a workflow merely by supplying T3 credentials.
