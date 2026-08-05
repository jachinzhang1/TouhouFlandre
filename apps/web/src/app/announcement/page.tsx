import { Megaphone } from "lucide-react";
import { PlaceholderPage } from "../../components/PlaceholderPage";

export default function AnnouncementPage() {
  return (
    <PlaceholderPage
      icon={Megaphone}
      eyebrow="ANNOUNCEMENTS"
      title="公告"
      text="当前暂无公告。"
    />
  );
}
