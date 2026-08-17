import type { ReactNode } from "react";
import { ExternalLink, Github } from "lucide-react";
import { BilibiliIcon } from "../../components/BilibiliIcon";
import { PixivIcon } from "../../components/PixivIcon";

type IconComponent = (props: {
  "aria-hidden"?: boolean | "true" | "false";
  size?: number;
}) => ReactNode;

type Platform = {
  name: string;
  href: string;
  Icon: IconComponent;
  className: string;
};

const platformStyles = {
  bilibili: "bg-[#fff0f5] text-[#fb7299]",
  github: "bg-[#f1f3f5] text-[#24292f]",
  pixiv: "bg-[#e8f3ff] text-[#0096fa]",
} as const;

const assetCredits = [
  {
    eyebrow: "像素肖像素材",
    title: "苗库里 - 哔哩哔哩个人空间",
    description: "东方全角色像素肖像素材包原作者",
    href: "https://space.bilibili.com/152309938",
    Icon: BilibiliIcon,
    iconClassName: platformStyles.bilibili,
  },
  {
    eyebrow: "首页封面图",
    title: "pixiv 作品 56866592",
    description: "首页视觉素材来源",
    href: "https://www.pixiv.net/artworks/56866592",
    Icon: PixivIcon,
    iconClassName: platformStyles.pixiv,
  },
];

const developers: Array<{ name: string; role: string; links: Platform[] }> = [
  {
    name: "Vitamin X",
    role: "核心功能开发",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/jachinzhang1",
        Icon: Github,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/518197475",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "常乐凯特",
    role: "核心功能开发",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/ChangleCat",
        Icon: Github,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/313519315",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "KrLite",
    role: "前端开发",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/KrLite",
        Icon: Github,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/399487383",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "哲狗",
    role: "基础设施提供",
    links: [
      {
        name: "Pixiv",
        href: "https://www.pixiv.net/users/24991762",
        Icon: PixivIcon,
        className: platformStyles.pixiv,
      },
    ],
  },
  {
    name: "存在的虚无",
    role: "数据校对、站点推广",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/452230036",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "赤色侠盗",
    role: "数据校对",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/387814829",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "陌望",
    role: "站点推广",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/3546908777777221",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
];

const friendLinks = [
  {
    eyebrow: "友情链接",
    title: "西电 Shining 动漫社 B站主页",
    description: "西电 Shining 动漫社官方哔哩哔哩空间",
    href: "https://space.bilibili.com/30032438",
    Icon: BilibiliIcon,
    iconClassName: platformStyles.bilibili,
  },
];

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
      <CreditSection title="开发者">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,320px))] gap-3">
          {developers.map((developer) => (
            <article
              className="flex min-h-[92px] items-center justify-between gap-4 rounded-[6px] border border-line bg-paper p-4 shadow-sm"
              key={developer.name}
            >
              <div className="min-w-0">
                <h3 className="m-0 text-[1.05rem] font-black leading-[1.35] text-ink">
                  {developer.name}
                </h3>
                <p className="mt-1 mb-0 text-[0.76rem] font-bold leading-[1.35] text-ink-soft">
                  {developer.role}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {developer.links.map(({ Icon, className, href, name }) => (
                  <a
                    aria-label={`${developer.name} 的 ${name} 主页`}
                    className={`inline-flex size-10 items-center justify-center rounded-[4px] no-underline transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-[1px] hover:shadow-sm ${className}`}
                    href={href}
                    key={href}
                    rel="noreferrer"
                    target="_blank"
                    title={`${developer.name} - ${name}`}
                  >
                    <Icon size={22} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </CreditSection>
      <CreditSection title="素材提供">
        <LinkCardGroup>
          {assetCredits.map((item) => (
            <ResourceCard key={item.href} {...item} />
          ))}
        </LinkCardGroup>
      </CreditSection>
      <CreditSection title="友情链接">
        <LinkCardGroup>
          {friendLinks.map((item) => (
            <ResourceCard key={item.href} {...item} />
          ))}
        </LinkCardGroup>
      </CreditSection>
    </section>
  );
}

function CreditSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="mt-[30px]">
      <h2 className="mt-0 mb-3 font-brand text-[1.35rem] font-bold leading-[1.25] text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function LinkCardGroup({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,420px))] gap-3">
      {children}
    </div>
  );
}

function ResourceCard({
  description,
  eyebrow,
  href,
  Icon,
  iconClassName,
  title,
}: {
  description: string;
  eyebrow: string;
  href: string;
  Icon: IconComponent;
  iconClassName: string;
  title: string;
}) {
  return (
    <a
      className="grid min-h-[96px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-[14px] rounded-[6px] border border-line bg-paper p-4 text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-[2px] hover:border-[var(--accent-hover-border)] hover:shadow-lg"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <span
        className={`inline-flex size-[52px] shrink-0 items-center justify-center rounded-[4px] ${iconClassName}`}
        aria-hidden="true"
      >
        <Icon size={28} />
      </span>
      <span className="grid min-w-0">
        <small className="text-[0.7rem] text-ink-soft">{eyebrow}</small>
        <strong className="mt-[2px] text-[1.05rem] leading-[1.4]">
          {title}
        </strong>
        <span className="mt-1 truncate text-[0.76rem] text-ink-soft">
          {description}
        </span>
      </span>
      <ExternalLink size={18} aria-hidden="true" />
    </a>
  );
}
