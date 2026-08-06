import { ExternalLink } from "lucide-react";
import { BilibiliIcon } from "../../components/BilibiliIcon";

export default function LinksPage() {
  return (
    <section className="min-h-[520px] px-[18px] pt-12 pb-6 max-[680px]:pt-[34px] max-[680px]:pb-[18px]">
      <div className="max-w-[720px]">
        <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          LINKS & CREDITS
        </p>
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
          友链与鸣谢
        </h1>
        <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">
          感谢为本项目提供创作资源与帮助的作者。
        </p>
      </div>
      <div className="mt-[30px] grid grid-cols-[repeat(auto-fit,minmax(280px,420px))] gap-3">
        <a
          className="grid min-h-[96px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-[14px] rounded-[6px] border border-line bg-paper p-4 text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-[2px] hover:border-[#af7a72] hover:shadow-lg"
          href="https://space.bilibili.com/152309938"
          target="_blank"
          rel="noreferrer"
        >
          <span
            className="inline-flex size-[52px] shrink-0 items-center justify-center rounded-[4px] bg-[#fff0f5] text-[#fb7299]"
            aria-hidden="true"
          >
            <BilibiliIcon size={28} />
          </span>
          <span className="grid min-w-0">
            <small className="text-[0.7rem] text-ink-soft">像素肖像素材</small>
            <strong className="mt-[2px] text-[1.05rem] leading-[1.4]">
              苗库里 - 哔哩哔哩个人空间
            </strong>
            <span className="mt-1 truncate text-[0.76rem] text-ink-soft">
              东方全角色像素肖像素材包原作者
            </span>
          </span>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      </div>
      <p className="mt-5 mb-0 max-w-[720px] text-[0.8rem] leading-[1.7] text-ink-soft">
        本项目中的角色像素头像经作者开放用于个人及非商业用途，包括同人作品、免费游戏与网站。素材版权归原作者所有。
      </p>
    </section>
  );
}
