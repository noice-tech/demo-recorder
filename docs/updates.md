# Updates and releases

Demo Recorder uses one product version for the `demo-video` skill, npm runtime, GitHub release, and runtime cache directory. A release such as `0.1.0` consists of:

- skill metadata version `0.1.0`;
- `@noice-tech/demo-recorder@0.1.0`;
- Git tag and GitHub release `v0.1.0`;
- stable `release-manifest.json` version `0.1.0`.

The skill always pins one exact runtime version. The runtime never updates itself, and update checks never install anything.

## User flow

Update checks are explicit. The user can ask their agent to check for Demo Recorder updates. The skill runs its cached runtime:

```bash
node "$DR_CLI" update check --json
```

When an update is available:

1. Show the new product version and release notes.
2. Ask before changing the installed skill.
3. Run the Skills CLI update command reported by the check, without `--yes`.
4. Ask the user to restart or reload the coding-agent session so it loads the new skill.
5. On its first activation, the updated skill asks before installing its exact runtime into a new versioned user-cache directory.
6. Run `doctor` before continuing.

The previous runtime remains cached for rollback. The skill must never install a newer runtime before the matching skill is active.

## Stable manifest

[`release-manifest.json`](../release-manifest.json) is the small, read-only metadata document used by `update check`. It describes a tested skill/runtime pair. The CLI validates its schema, product names, matching versions, tag, and HTTPS release-notes URL before reporting an update.

`doctor` remains offline. Network failure during an explicit update check must not affect recording with the installed version.

## Release order

Prepare and publish releases in this order:

1. Choose one new semantic version.
2. Update the CLI package version, skill metadata, pinned package commands, cache paths, and README alpha version together. Prepare the next manifest values, but do not promote them on the stable branch yet.
3. Build and verify the npm package.
4. Publish the exact npm version.
5. Create and push the matching Git tag.
6. Publish GitHub release notes.
7. Update the stable release manifest in a final promotion commit.

Publishing the manifest last prevents installed clients from being directed to an incomplete release. Never point stable metadata at an unpublished npm package or missing skill tag.

Documentation-only or skill-only changes still receive a new unified product version. The versions can be separated later if independent skill releases become frequent.
