import type { ComponentType } from "react";
import type {
  GuessField,
  MultiParticipantRole,
  MultiplayerMode,
} from "@touhouflandre/shared";
import type { RoomActions, RoomUiState } from "../hooks/useRoom";
import { RelayStageView } from "../components/RelayStageView";
import { RaceMatchExperience } from "./modes/race/RaceMatchExperience";

export interface MultiplayerMatchExperienceProps {
  roomId: string;
  token: string;
  state: RoomUiState;
  format: string;
  fields: readonly GuessField[];
  memberId: string | null;
  role: MultiParticipantRole | null;
  actions: RoomActions;
  onLeave: () => void;
}

const RaceExperience: ComponentType<MultiplayerMatchExperienceProps> = (
  props,
) => (
  <RaceMatchExperience
    state={props.state}
    format={props.format}
    fields={props.fields}
    memberId={props.memberId}
    role={props.role}
    actions={props.actions}
    onLeave={props.onLeave}
  />
);

const RelayExperience: ComponentType<MultiplayerMatchExperienceProps> = (
  props,
) => {
  const { state } = props;
  if (!state.match || !state.relay || !state.viewer) return null;
  return (
    <RelayStageView
      roomId={props.roomId}
      token={props.token}
      format={props.format}
      projection={state.relay}
      members={state.members}
      viewer={state.viewer}
      catalogVersion={state.catalogVersion ?? undefined}
      fields={props.fields}
      roomStatus={state.room?.status ?? "playing"}
      retentionEndsAt={
        state.matchResult?.retentionEndsAt ?? state.room?.expiresAt
      }
      matchResult={state.matchResult}
      rematchReady={state.rematchReady}
      actions={props.actions}
      onRematch={props.actions.rematch}
      onLeave={props.onLeave}
    />
  );
};

export const multiplayerMatchExperienceRegistry = {
  race: RaceExperience,
  relay: RelayExperience,
} satisfies Record<
  MultiplayerMode,
  ComponentType<MultiplayerMatchExperienceProps>
>;

export function matchExperienceFor(mode: MultiplayerMode) {
  return multiplayerMatchExperienceRegistry[mode];
}
