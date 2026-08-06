import { notFound } from "next/navigation";
import { RoomView } from "../../../../components/RoomPage";
import { isValidRoomCode, normalizeRoomCode } from "../../../../domain/multiRoom";

export default async function MultiRoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // [code] 校验非法值 → notFound()（08 §10.1）
  if (!isValidRoomCode(normalizeRoomCode(code))) {
    notFound();
  }
  return <RoomView code={code} />;
}
