# Authentication

Authentication state can contain account access. Never print it, commit it, place it in a plan, or copy it into a recording.

Saved state is needed for authenticated **launched** browsers. Attached CDP exploration can reuse the user's existing login, but cannot record video. Rehearsal and recording launch fresh browsers, so save login state for those stages even if exploration used an attached browser.

Start a headed session:

```bash
node "$DR_CLI" auth start --project ./demo --url https://example.com/login --headed
```

Tell the user to complete login, MFA, CAPTCHA, and consent in the visible browser. After the user explicitly says they are finished:

```bash
node "$DR_CLI" auth save --project ./demo
```

`auth save` writes `./demo/auth-state.json` and closes the browser. Use it for exploration by passing the file:

```bash
node "$DR_CLI" explore start --project ./demo --url https://example.com --storage-state ./demo/auth-state.json
```

The plan itself has no auth field, so keep the same `--storage-state` for the launched browser used by `plan rehearse` and `record` (add `--headed` when a fingerprint or CAPTCHA blocks an unattended run). Remove the state with:

```bash
node "$DR_CLI" auth remove --project ./demo
```

Never attempt to solve or bypass a CAPTCHA automatically. If the next run fails on an expired session, redo `auth start` and `auth save`. There is no separate verify step.
