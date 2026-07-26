# Exploration

## Agent-directed session

Use a persistent session when the feature depends on same-page controls such as tabs, menus, dialogs, drawers, or other SPA state:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore start \
  --url https://example.com \
  --session product-demo \
  --goal "Find the feature requested by the user" \
  --json
```

The response contains the current observation, temporary control refs, risk classifications, and paths to an ARIA snapshot and viewport screenshot. Refs are valid only for that observation.

Propose one bounded action at a time in a JSON file:

```json
{
  "type": "click",
  "observationId": "obs-0001",
  "ref": "e4",
  "reason": "Open the templates tab"
}
```

Then execute it:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore act product-demo \
  --input action.json \
  --json
```

Supported session actions are `click`, `hover`, `goto`, `back`, `scroll`, and bounded `wait`. The default `read-only` policy allows same-origin navigation and controls classified as presentational. Unknown, mutation-like, destructive, form, and external-side-effect controls are blocked. Open shadow-root controls are discoverable through Playwright locators. Child-frame controls do not receive main-frame refs in this version; treat them as unsupported and report the limitation rather than guessing a selector.

Use `--policy reversible` only when the user explicitly requested it and the target is a disposable local or staging environment. It still does not permit destructive or external-side-effect controls. These policies are conservative guardrails, not proof that an application cannot produce a server-side side effect.

Search the current observation without loading the whole snapshot, or request another observation when needed:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --text "Templates" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --regex "template|gallery" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore observe product-demo --json
```

After selecting a connected sequence of successful transitions, verify it in a fresh browser context before using it for planning:

```json
{
  "version": 1,
  "transitionIds": ["transition-0001", "transition-0002"]
}
```

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore verify product-demo \
  --input verification-path.json \
  --json
```

Verification never reuses temporary element refs. It resolves the recorded durable locator candidates, requires a unique visible match, checks each expected semantic state and URL, and writes a report, screenshots, and Playwright trace under `verification/`.

A passing verification can be exported to a validating draft plan while the session is active:

```json
{
  "version": 1,
  "verificationId": "verification-0001",
  "name": "product-demo",
  "goal": "Show the verified product workflow",
  "audience": "Prospective users",
  "targetDurationMs": 20000
}
```

If the verified initial route or an explicit `goto` transition depends on a query string or
fragment, export refuses to persist that URL state by default. Add `"includeUrlState": true` to
the request only after confirming those values contain no credentials, tokens, or private data.

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore export-plan product-demo \
  --input draft-request.json \
  --output .demo-recorder/plans/product-demo/demo-plan.json \
  --json
```

The exporter uses the locator candidate actually proven during replay, retains bounded fallbacks, and compiles observed URL/heading changes into ordinary plan assertions. Review and edit the draft as a director; it is not semantic story generation.

Always close the session:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore finish product-demo --json
```

Use `explore abort product-demo` after an unrecoverable failure. `explore status` lists active sessions.

## One-shot surface map

Use the bounded mapper for ordinary link-based sites:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore \
  --url https://example.com \
  --max-pages 10 \
  --max-depth 2
```

## Local repository

First inspect startup documentation and scripts. A persistent session owns the managed process until `finish` or `abort`:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore start \
  --repo /path/to/app \
  --start 'pnpm dev' \
  --url http://localhost:3000 \
  --session local-demo \
  --json
```

Use `--auth <profile>` for saved authentication and `--headed` only for diagnosis.

Never upload, purchase, publish, delete, send, invite, deploy, grant OAuth consent, or expose secrets during exploration. Read `exploration.json`, `summary.md`, observations, ARIA snapshots, and relevant screenshots before writing a plan. When a local repository is available, inspect relevant source and startup scripts with the agent's repository tools; never expose values from `.env` or runtime output.
