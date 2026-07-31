# Authentication

Authentication state can contain account access. Never print it, commit it, place it in a plan, or copy it into a recording.

Start a detached headed session:

```bash
node "$DR_CLI" auth start \
  --url https://example.com/login \
  --profile example
```

Tell the user to complete login, MFA, CAPTCHA, and consent in the visible browser. After the user explicitly says they are finished:

```bash
node "$DR_CLI" auth save --profile example
node "$DR_CLI" auth verify --profile example
```

Use it during exploration with `--auth example`, or set `target.authProfile` in a plan. State is plain JSON under ignored `.demo-recorder/auth/example/`, with restricted permissions where supported.

Maintenance:

```bash
node "$DR_CLI" auth list
node "$DR_CLI" auth stop --profile example
node "$DR_CLI" auth remove --profile example
```

If state cannot be reused because of fingerprint or CAPTCHA restrictions, run recording with `--headed` and explain the limitation. Never attempt to solve or bypass a CAPTCHA automatically.
