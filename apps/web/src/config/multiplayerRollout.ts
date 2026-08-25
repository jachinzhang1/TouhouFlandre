const flagEnabled = (value: string | undefined, fallback = true) => {
  switch (value?.trim().toLowerCase()) {
    case "1":
    case "true":
    case "t":
    case "yes":
    case "y":
    case "on":
      return true;
    case "0":
    case "false":
    case "f":
    case "no":
    case "n":
    case "off":
      return false;
    default:
      return fallback;
  }
};

export const isNPlayerRaceUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED);

export const isNPlayerRelayUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED, false);

export const isRelayEliminationUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED, false);

export const isChatUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED);

export const isChatSendUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_CHAT_SEND_ENABLED);
