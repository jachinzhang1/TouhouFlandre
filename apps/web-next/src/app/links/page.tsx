import { ExternalLink } from "lucide-react";
import { BilibiliIcon } from "../../components/BilibiliIcon";

export default function LinksPage() {
  return (
    <section className="page-panel links-page">
      <div className="page-heading">
        <p className="kicker">LINKS & CREDITS</p>
        <h1>友链与鸣谢</h1>
        <p>感谢为本项目提供创作资源与帮助的作者。</p>
      </div>
      <div className="friend-links">
        <a
          className="friend-link"
          href="https://space.bilibili.com/152309938"
          target="_blank"
          rel="noreferrer"
        >
          <span className="friend-link-icon" aria-hidden="true">
            <BilibiliIcon size={28} />
          </span>
          <span className="friend-link-copy">
            <small>像素肖像素材</small>
            <strong>苗库里 - 哔哩哔哩个人空间</strong>
            <span>东方全角色像素肖像素材包原作者</span>
          </span>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      </div>
      <p className="asset-note">
        本项目中的角色像素头像经作者开放用于个人及非商业用途，包括同人作品、免费游戏与网站。素材版权归原作者所有。
      </p>
    </section>
  );
}
