const createButton = document.querySelector("#create-project");
const emptyState = document.querySelector("#empty-state");
const projectState = document.querySelector("#project-state");
const briefStep = document.querySelector("#brief-step");
const launchButton = document.querySelector("#launch-project");
const launchHelp = document.querySelector("#launch-help");
const status = document.querySelector("#status");
const success = document.querySelector("#success");
const overviewTab = document.querySelector("#overview-tab");
const activityTab = document.querySelector("#activity-tab");
const workspaceTabHeading = document.querySelector("#workspace-tab-heading");
const workspaceTabCopy = document.querySelector("#workspace-tab-copy");
const detailsDialog = document.querySelector("#details-dialog");
const insightsButton = document.querySelector("#view-insights");
const insightsStatus = document.querySelector("#insights-status");

function selectWorkspaceTab(tab) {
  const activitySelected = tab === activityTab;
  overviewTab.setAttribute("aria-selected", String(!activitySelected));
  activityTab.setAttribute("aria-selected", String(activitySelected));
  workspaceTabHeading.textContent = activitySelected ? "Recent activity" : "Workspace overview";
  workspaceTabCopy.textContent = activitySelected
    ? "The launch brief was updated today."
    : "Three projects are ready for review.";
}

overviewTab.addEventListener("click", () => selectWorkspaceTab(overviewTab));
activityTab.addEventListener("click", () => selectWorkspaceTab(activityTab));
document.querySelector("#open-details").addEventListener("click", () => detailsDialog.showModal());
document.querySelector("#close-details").addEventListener("click", () => detailsDialog.close());
insightsButton.addEventListener("click", () => {
  insightsButton.disabled = true;
  insightsStatus.textContent = "Loading insights…";
  setTimeout(() => {
    insightsStatus.textContent = "Insights ready";
    insightsButton.setAttribute("aria-expanded", "true");
    insightsButton.disabled = false;
  }, 350);
});
const shadowRoot = document.querySelector("#shadow-host").attachShadow({ mode: "open" });
shadowRoot.innerHTML = '<button id="shadow-preview">Open shadow preview</button>';

createButton.addEventListener("click", () => {
  emptyState.hidden = true;
  projectState.hidden = false;
  createButton.textContent = "Project created";
  createButton.disabled = true;
});

briefStep.addEventListener("click", () => {
  const approved = briefStep.getAttribute("aria-pressed") !== "true";
  briefStep.setAttribute("aria-pressed", String(approved));
  briefStep.querySelector("strong").textContent = approved ? "Brief approved" : "Approve brief";
  launchButton.disabled = !approved;
  launchHelp.textContent = approved
    ? "Everything is ready for launch."
    : "Complete the brief to enable launch.";
  status.textContent = approved ? "Ready" : "Draft";
});

launchButton.addEventListener("click", () => {
  success.hidden = false;
  launchButton.textContent = "Launched";
  launchButton.disabled = true;
  status.textContent = "Live";
});
