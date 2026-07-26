export const destructiveActionPattern =
  /\b(delete|remove|erase|destroy|purchase|buy|pay|publish|send|invite|deploy|merge|revoke|reset|cancel subscription|confirm order|place order|sign out|log out)\b/i;

export const mutationActionPattern =
  /\b(create|add|upload|approve|launch|save|edit|rename|subscribe|follow|submit|sign up|create account|checkout)\b/i;

export const formSubmissionPattern =
  /\b(submit|sign up|create account|send message|subscribe|checkout|place order)\b/i;

export const externalEffectPattern =
  /\b(oauth|authorize|grant access|download|install|open in|continue to)\b/i;

export const presentationalActionPattern =
  /\b(open|close|view|show|hide|expand|collapse|next|previous|back|menu|tab|details|preview|examples?|features?|templates?)\b/i;

export const navigationActionPattern =
  /\b(home|about|pricing|examples?|features?|docs|blog|next|previous|back|menu|open|learn|view)\b/i;
