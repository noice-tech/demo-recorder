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

The response contains a compact observation summary with viewport control refs, risk classifications, total/returned control counts, and paths to the complete observation, ARIA snapshot, and viewport screenshot. Refs are valid only for that observation. Use `find` or read the full observation artifact when an offscreen control is omitted from the summary.

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

A successful `act` response includes both the transition and the already-captured resulting observation with fresh refs. Continue from that observation instead of issuing a redundant `observe` command.

Supported session actions are `click`, `hover`, `goto`, `back`, finite `scroll`, and bounded `wait`. Use `find` to identify content and a small number of direct exploration scrolls to inspect it. Do not copy incremental exploratory scrolls into the final plan; combine them into the fewest directed capture scrolls that preserve the intended story.

The default `read-only` policy allows same-origin navigation and controls classified as presentational. Unknown, mutation-like, destructive, form, and external-side-effect controls are blocked. Open shadow-root controls are discoverable through Playwright locators. Child-frame controls do not receive main-frame refs in this version; treat them as unsupported and report the limitation rather than guessing a selector.

Use `--policy reversible` only when the user explicitly requested it and the target is a disposable local or staging environment. It still does not permit destructive or external-side-effect controls. These policies are conservative guardrails, not proof that an application cannot produce a server-side side effect.

Search controls, headings, layers, and accessible page text without loading the whole snapshot, or retrieve the existing compact observation without recapturing it:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --text "Templates" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --regex "template|gallery" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore current product-demo --json
```

Reserve `explore observe` for pages that changed without an explorer action, such as externally updated or time-driven UI.

For an ordinary directed request, use one persistent session and usually no more than 6–10 actions. Stop when the requested targets, routes, and approximate scroll deltas are known. Do not restart merely to create a cleaner journal.

After selecting a connected sequence of successful transitions, verify it once in a fresh browser context before using it for planning:

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

Verification never reuses temporary element refs. It resolves the recorded durable locator candidates, requires a unique visible match, checks each expected semantic state and URL, and writes a report, screenshots, and Playwright trace under `verification/`. If verification fails, inspect the report and make at most one focused clean retry. Do not fan out into several exploratory sessions or locator strategies.

A passing verification must be exported as the default planner handoff while the session is active whenever the requested story is representable by the verified path:

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

The exporter uses the locator candidate actually proven during replay, retains bounded fallbacks, and compiles observed URL/heading changes into ordinary plan assertions. Treat its navigation, click, move, scroll, locator, URL, and generated assertion steps as the verified interaction core. Do not manually reconstruct those steps. Editorial edits may change the brief, purposes, timing holds, beats, and presentation. If the story needs an interaction export cannot represent, change only that unsupported portion and require rehearsal to prove it. Write a plan from scratch only when there is no verified interactive path. The exporter is a deterministic handoff, not semantic story generation.

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
