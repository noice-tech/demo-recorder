import { join } from "node:path";
import {
  listAuthProfiles,
  removeAuthProfile,
  saveAuthSession,
  startAuthSession,
  stopAuthSession,
  verifyAuthProfile,
} from "./explorer/index.js";
import { stringOption, type ParsedArguments } from "./arguments.js";
import { workingDirectory } from "./paths.js";

const authRoot = join(workingDirectory, ".demo-recorder/auth");

function requireProfile(arguments_: ParsedArguments): string {
  const profile = stringOption(arguments_, "profile") ?? arguments_.positionals[0];
  if (!profile) throw new Error("Authentication command requires --profile <name>");
  return profile;
}

export async function authCommand(
  operation: string | undefined,
  arguments_: ParsedArguments,
): Promise<void> {
  if (operation === "start") {
    const profile = requireProfile(arguments_);
    const url = stringOption(arguments_, "url");
    if (!url) throw new Error("auth start requires --url <login-url>");
    const session = await startAuthSession({ rootDirectory: authRoot, profile, baseUrl: url });
    console.log(`[demo-recorder] Headed authentication browser opened for profile: ${profile}`);
    console.log(
      `[demo-recorder] Complete login/CAPTCHA, then ask the agent to run the cached CLI: auth save --profile ${profile}`,
    );
    console.log(`[demo-recorder] Authentication session PID: ${session.pid}`);
    return;
  }
  if (operation === "save") {
    const profile = requireProfile(arguments_);
    await saveAuthSession(authRoot, profile);
    console.log(`[demo-recorder] Authentication state saved: ${profile}`);
    return;
  }
  if (operation === "stop") {
    const profile = requireProfile(arguments_);
    await stopAuthSession(authRoot, profile);
    console.log(`[demo-recorder] Authentication session stopped: ${profile}`);
    return;
  }
  if (operation === "verify") {
    const profile = requireProfile(arguments_);
    const result = await verifyAuthProfile(authRoot, profile);
    console.log(`[demo-recorder] Authentication profile opened: ${result.finalUrl}`);
    console.log(
      `[demo-recorder] Password field visible: ${result.hasPasswordField ? "yes" : "no"}`,
    );
    return;
  }
  if (operation === "remove") {
    const profile = requireProfile(arguments_);
    await removeAuthProfile(authRoot, profile);
    console.log(`[demo-recorder] Authentication profile removed: ${profile}`);
    return;
  }
  if (operation === "list") {
    const profiles = await listAuthProfiles(authRoot);
    console.log(profiles.length > 0 ? profiles.join("\n") : "No authentication profiles");
    return;
  }
  throw new Error(
    "Usage: demo-recorder auth <start|save|stop|verify|remove|list> [--profile name] [--url URL]",
  );
}
