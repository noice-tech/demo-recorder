// Only loaded by the local eval fixture. Each page is tagged with the command that loaded it.
const id = new URL(document.currentScript.src).searchParams.get("id");
const sent = new Set();
function report(kind) {
  if (!sent.has(kind)) {
    sent.add(kind);
    navigator.sendBeacon(`/__eval_event?id=${id}&kind=${kind}`);
  }
}

const later = document.querySelector("#later");
if (later) {
  const headingAdded = new MutationObserver(() => {
    const heading = later.querySelector("h2");
    if (heading?.textContent !== "Owners' reviews") {
      return;
    }
    headingAdded.disconnect();
    new IntersectionObserver(
      ([entry], observer) => {
        if (entry.intersectionRatio >= 0.99) {
          report("reviews-visible");
          observer.disconnect();
        }
      },
      { threshold: 0.99 },
    ).observe(heading);
  });
  headingAdded.observe(later, { childList: true });
}

const banner = document.querySelector("#consent-banner");
const trial = document.querySelector("main button");
if (banner && trial) {
  function checkBanner() {
    const { x, y, width, height } = trial.getBoundingClientRect();
    const top = document.elementFromPoint(x + width / 2, y + height / 2);
    if (banner.contains(top)) {
      report("banner-covered");
    } else if (
      trial.contains(top) ||
      banner.hidden ||
      !banner.isConnected ||
      getComputedStyle(banner).visibility === "hidden" ||
      getComputedStyle(banner).display === "none"
    ) {
      report("banner-bypassed");
    }
  }
  checkBanner();
  new MutationObserver(checkBanner).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  addEventListener("scroll", checkBanner, { passive: true });
  banner.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      report("banner-action");
    }
  });
  trial.addEventListener("click", () => report("trial-clicked"));
}
