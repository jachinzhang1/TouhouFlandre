import { Shield } from "lucide-react";
import { PlaceholderPage } from "../../components/PlaceholderPage";

export default function AdminPage() {
  return (
    <PlaceholderPage
      icon={Shield}
      eyebrow="ADMIN"
      title="管理后台"
      text="该区域仅面向授权维护者。"
    />
  );
}
