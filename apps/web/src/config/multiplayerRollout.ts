const flagEnabled = (value: string | undefined) => {
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
      return true;
  }
};

export const isNPlayerRaceUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED);

export const isChatUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED);

export const isChatSendUiEnabled = () =>
  flagEnabled(process.env.NEXT_PUBLIC_MULTI_CHAT_SEND_ENABLED);
