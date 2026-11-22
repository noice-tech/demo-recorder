# Example fixture

A deterministic, dependency-free product screen used only by CLI integration and package smoke tests.

Expected flow:

1. Click **Create project**.
2. Click **Approve brief**.
3. Click **Launch project**.
4. Wait for **Project launched**.

Reloading the page restores the initial state. All important controls use accessible names for semantic Playwright locators.

`obstacles.html` holds controls that fail on purpose: **Start trial** sits under a fixed cookie banner, **Open store** links to `/stall/store`, which the test server never answers, and **Back to workspace** returns to the main screen.
