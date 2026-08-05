import { Search } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

export default function NotFound() {
  return (
    <PlaceholderPage
      icon={Search}
      eyebrow="404"
      title="页面不存在"
      text="这个地址暂时没有对应页面。"
    />
  );
}
