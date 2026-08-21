import { expect, type Locator } from "@playwright/test";

export const MUSIC_AUDIO_SELECTOR = '[data-music-player-audio="true"]';
export const MUSIC_TRACK_SOURCE_PATTERN =
  /\/music\/tracks\/[^?#]+\.mp3(?:[?#].*)?$/u;

export type MusicPlayerTrackSnapshot = {
  id: string;
  title: string;
  isCurrent: boolean;
};

export async function readCurrentTrackTitle(card: Locator): Promise<string> {
  return card
    .getByRole("heading")
    .evaluate(
      (heading) =>
        heading
          .querySelector<HTMLElement>("[aria-label]")
          ?.getAttribute("aria-label") ??
        heading.textContent?.trim() ??
        "",
    );
}

export async function readTrackList(
  card: Locator,
): Promise<MusicPlayerTrackSnapshot[]> {
  const items = card.locator(".music-player-track-list-item");
  await expect(items.first()).toBeVisible();
  return items.evaluateAll((elements) =>
    elements
      .map((element) => {
        const titleElement = element.querySelector<HTMLElement>(
          ".music-player-track-list-title",
        );
        return {
          id: element.getAttribute("data-music-player-track-id") ?? "",
          title:
            titleElement?.getAttribute("aria-label") ??
            titleElement?.textContent?.trim() ??
            "",
          isCurrent: element.getAttribute("aria-current") === "true",
        };
      })
      .filter((track) => track.id && track.title),
  );
}

export async function openTrackList(card: Locator): Promise<void> {
  const toggle = card.getByRole("button", {
    name: "曲目列表",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    card.locator(".music-player-track-list-item").first(),
  ).toBeVisible();
}

export async function chooseTrackView(dialog: Locator): Promise<void> {
  await dialog.getByText("按曲目", { exact: true }).click();
  await expect(dialog.getByRole("checkbox").first()).toBeVisible();
}

export async function getTrackCheckbox(
  dialog: Locator,
  trackIndex: number,
): Promise<Locator> {
  const checkbox = dialog.getByRole("checkbox").nth(trackIndex);
  await expect(checkbox).toBeVisible();
  return checkbox;
}

export async function readPlaylistCount(
  dialog: Locator,
): Promise<{ selected: number; total: number }> {
  const text = await dialog
    .locator(".music-playlist-dialog-count")
    .textContent();
  const match = text?.match(/(\d+)\s*\/\s*(\d+)/u);
  if (!match) throw new Error(`Unexpected playlist count: ${text ?? ""}`);
  return { selected: Number(match[1]), total: Number(match[2]) };
}
