import { readAnnouncements } from "../../announcements/catalog";
import { AnnouncementPage } from "../../components/AnnouncementPage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AnnouncementRoute() {
  const { announcements } = await readAnnouncements();
  return <AnnouncementPage initialAnnouncements={announcements} />;
}
