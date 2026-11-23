# Example fixture

A deterministic, dependency-free product screen used only by CLI integration and package smoke tests.

Expected flow:

1. Click **Create project**.
2. Click **Approve brief**.
3. Click **Launch project**.
4. Wait for **Project launched**.

Reloading the page restores the initial state. All important controls use accessible names for semantic Playwright locators.

`obstacles.html` holds controls that fail on purpose: **Start trial** sits under a fixed cookie banner, **Open store** links to `/stall/store`, which the test server never answers, and **Back to workspace** returns to the main screen. **Visit partner**, **Open partner window** and the embedded frame lead to `partner.html` on the server's other name (`localhost` for `127.0.0.1`), which is another origin. The **Finish** group holds controls that sites make hard: a radio under its own label, a selector that also matches a hidden copy, and a button whose name starts with an icon-font glyph. **Accept cookies** appears in the banner 800 ms after load.

`long.html` renders its **Reviews** section only once the page is scrolled near it, as lazy product pages do.
