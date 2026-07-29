# Synchronizing T3 Code

Sigma Code follows stable T3 Code releases only. Nightly tags and unmerged pull
requests are not downstream inputs.

The T3 Code repository is configured as the `upstream` remote. Every imported
stable release has an immutable local reference named `sync/t3-vX.Y.Z`.

## Import a stable release

1. Fetch the intended stable tag without changing the working branch:

   ```sh
   git fetch upstream tag vX.Y.Z --no-recurse-submodules
   ```

2. Verify that `vX.Y.Z` is a published, non-prerelease T3 Code release and
   inspect its release notes and diff from the prior imported tag.

3. Record the upstream point:

   ```sh
   git branch sync/t3-vX.Y.Z vX.Y.Z
   ```

4. Create a temporary integration branch from the current Sigma Code branch:

   ```sh
   git switch -c sync/t3-vX.Y.Z-integration
   git merge --no-ff sync/t3-vX.Y.Z
   ```

5. Resolve conflicts by preserving Sigma Code's isolation boundaries:
   `~/.sigma/code`, `sigmacode`, Sigma application identifiers, disabled
   telemetry, and disabled cloud/update services unless Sigma-owned
   configuration exists.

6. Run the focused server, web, desktop, ACP driver, packaging, and legal-file
   checks. Confirm that no T3 production host, update repository, Clerk key,
   relay, signing identity, or `~/.t3` path is reachable.

7. Merge the reviewed integration branch into the maintained Sigma Code branch.
   Keep conflict-resolution changes separate from unrelated product work.

The initial downstream baseline is T3 Code `v0.0.30`
(`60af905e70c944228cb35a74fa50740ec4b2d1f7`).
