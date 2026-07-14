# VPS deployment procedure

`deploy/vps` is a private integration branch for the VPS. It may contain several
reviewed fixes before they are merged upstream. Do not open an upstream PR from
this branch.

## Branch workflow

1. Create each fix branch from `upstream/main` and open a separate PR to
   `Casys-AI/mcp-erpnext:main`.
2. Merge the tested fix branches into `deploy/vps` when the VPS needs them.
3. Build and deploy the exact `deploy/vps` commit as a local npm tarball.
4. Once all included PRs have merged upstream, recreate `deploy/vps` from
   `upstream/main`.

## Deploy an integration commit

This MCP runs on the VPS as a pnpm-installed local `@casys/mcp-erpnext` tarball,
not from a Git checkout, Docker image, or registry release.

1. **Approve the deployment.** Record the exact commit to deploy:

   ```sh
   git rev-parse deploy/vps
   ```

2. **Stage that exact commit** in a detached checkout. Do not deploy an
   uncommitted working tree.

3. **Validate and build** from the staging checkout:

   ```sh
   deno task release:check
   deno task ui:build
   ./scripts/build-node.sh
   (cd dist-node/bin && npm pack)
   sha256sum dist-node/bin/*.tgz
   ```

4. **Preserve rollback material** before installation: the current tarball,
   package manifest, lockfile, installed bundle checksum, and deployed commit.

5. **Install the new tarball** with pnpm by updating the existing local `file:`
   dependency. Do not publish to npm or JSR. Verify the installed package
   metadata and bundle checksum match the staged tarball.

6. **Obtain separate approval before restarting services.** Reload/restart only
   the MCP gateway services that consume this package, one at a time.

7. **Verify after every restart:** service health, MCP connection, tool
   discovery, and the schemas needed by the deployed fixes.

## Rollback

If installation or verification fails, restore the saved tarball, package
manifest, and lockfile; reinstall with pnpm; restart the affected gateway; and
repeat the same health and MCP checks. Record the failed commit and do not
continue the rollout.

> This document intentionally contains no host paths, service names, or
> credentials. Use the VPS-managed package configuration and service inventory
> when executing it.
