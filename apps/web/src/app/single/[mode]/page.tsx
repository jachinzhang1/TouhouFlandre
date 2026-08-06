import { notFound } from "next/navigation";
import { isSinglePlayerGameMode } from "@touhouflandre/shared";
import type { SinglePlayerGameMode } from "@touhouflandre/shared";
import { SingleGamePage } from "../../../components/SingleGamePage";

export default async function SingleGameRoute({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!isSinglePlayerGameMode(mode)) notFound();
  return <SingleGamePage mode={mode as SinglePlayerGameMode} />;
}
