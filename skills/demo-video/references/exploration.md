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

Supported session actions are `click`, `hover`, `goto`, `back`, `scroll`, and bounded `wait`. The default `read-only` policy allows same-origin navigation and controls classified as presentational. Unknown, mutation-like, destructive, form, and external-side-effect controls are blocked.

Use `--policy reversible` only when the user explicitly requested it and the target is a disposable local or staging environment. It still does not permit destructive or external-side-effect controls. These policies are conservative guardrails, not proof that an application cannot produce a server-side side effect.

Search the current observation without loading the whole snapshot, or request another observation when needed:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --text "Templates" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore find product-demo --regex "template|gallery" --json
npx --yes @noice-tech/demo-recorder@0.0.1 explore observe product-demo --json
```

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

Never upload, purchase, publish, delete, send, invite, deploy, grant OAuth consent, or expose secrets during exploration. Read `exploration.json`, `summary.md`, observations, ARIA snapshots, and relevant screenshots before writing a plan. Repository reports include environment-variable names only; never expose values from `.env` or runtime output.
