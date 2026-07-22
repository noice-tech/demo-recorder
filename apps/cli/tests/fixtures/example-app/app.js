const createButton = document.querySelector("#create-project");
const emptyState = document.querySelector("#empty-state");
const projectState = document.querySelector("#project-state");
const briefStep = document.querySelector("#brief-step");
const launchButton = document.querySelector("#launch-project");
const launchHelp = document.querySelector("#launch-help");
const status = document.querySelector("#status");
const success = document.querySelector("#success");

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
