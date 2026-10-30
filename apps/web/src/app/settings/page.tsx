import { normalizeRoomCode } from "../../domain/multiRoom";
import { QuestionScopePage } from "../../components/question-scope/QuestionScopePage";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsRoute({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string | string[];
    source?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const source = first(params.source);
  const room = first(params.room);
  return (
    <QuestionScopePage
      backHref={source === "multi" ? "/multi" : "/single"}
      roomCode={room ? normalizeRoomCode(room) : undefined}
    />
  );
}
