# Exploration

## External site

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore \
  --url https://example.com \
  --max-pages 10 \
  --max-depth 2
```

## Local repository

First inspect startup documentation and scripts. Then pass the selected command explicitly:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 explore \
  --repo /path/to/app \
  --start 'pnpm dev' \
  --url http://localhost:3000
```

Use `--auth <profile>` for saved authentication and `--headed` only for diagnosis. Exploration follows ordinary same-origin HTTP links directly and records controls for agent analysis. It does not submit forms or click ambiguous/destructive controls.

Allowed inspection includes navigation, DOM/accessibility summaries, links, tabs/menu candidates, screenshots, scrolling, redirects, and errors. Never upload, purchase, publish, delete, send, invite, grant OAuth consent, or modify application data during exploration.

Read `.demo-recorder/explorations/<id>/exploration.json`, `summary.md`, and screenshots before writing a plan. Repository reports include environment variable names only; never expose values from `.env` or runtime output.
