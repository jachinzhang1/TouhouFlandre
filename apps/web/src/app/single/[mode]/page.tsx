import { notFound } from "next/navigation";
import { isSinglePlayerGameMode } from "@touhoufriberg/shared";
import type { SinglePlayerGameMode } from "@touhoufriberg/shared";
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
