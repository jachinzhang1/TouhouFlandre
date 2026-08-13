import type { ReactNode } from "react";
import { Github } from "lucide-react";
import { BilibiliIcon } from "../../components/BilibiliIcon";
import { PixivIcon } from "../../components/PixivIcon";
import { Paper } from "../../components/Paper";

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
  bilibili: "text-[#fb7299]",
  github: "text-ink",
  pixiv: "text-[#0096fa]",
} as const;

const assetCredits = [
  {
    title: "苗库里 - 哔哩哔哩个人空间",
    subtitle: "东方全角色像素肖像素材包原作者",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/152309938",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    title: "pixiv 作品 50752377",
    subtitle: "首页视觉素材来源",
    links: [
      {
        name: "Pixiv",
        href: "https://www.pixiv.net/artworks/50752377",
        Icon: PixivIcon,
        className: platformStyles.pixiv,
      },
    ],
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
    title: "西电 Shining 动漫社 B站主页",
    subtitle: "西电 Shining 动漫社官方哔哩哔哩空间",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/30032438",
        Icon: BilibiliIcon,
        className: platformStyles.bilibili,
      },
    ],
  },
];

export default function LinksPage() {
  return (
    <section className="min-h-[520px] pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
      <header className="text-center">
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-black leading-[1.15] max-[680px]:text-[2.05rem]">
          友链与鸣谢
        </h1>
        <p className="mx-auto mt-3 mb-0 flex min-h-7 max-w-[720px] items-center justify-center text-center font-brand leading-[1.75] text-ink-soft">
          感谢为本项目提供创作资源与帮助的作者。
        </p>
      </header>

      <CreditSection title="素材提供">
        <CreditEntryGroup>
          {assetCredits.map((item) => (
            <CreditEntryButton key={item.title} {...item} />
          ))}
        </CreditEntryGroup>
      </CreditSection>

      <CreditSection title="开发者">
        <CreditEntryGroup>
          {developers.map((developer) => (
            <CreditEntryButton
              key={developer.name}
              links={developer.links}
              subtitle={developer.role}
              title={developer.name}
            />
          ))}
        </CreditEntryGroup>
      </CreditSection>

      <CreditSection title="友情链接">
        <CreditEntryGroup>
          {friendLinks.map((item) => (
            <CreditEntryButton key={item.title} {...item} />
          ))}
        </CreditEntryGroup>
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
    <section className="mt-9">
      <div className="mb-4 flex items-center gap-[clamp(10px,2vw,18px)]">
        <span className="credit-section-rule" aria-hidden="true" />
        <h2 className="m-0 shrink-0 text-center font-brand text-[1.35rem] font-bold leading-[1.25] text-ink">
          {title}
        </h2>
        <span
          className="credit-section-rule credit-section-rule-right"
          aria-hidden="true"
        />
      </div>
      {children}
    </section>
  );
}

function CreditEntryGroup({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
      {children}
    </div>
  );
}

function CreditEntryButton({
  links,
  subtitle,
  title,
}: {
  links: Platform[];
  subtitle: string;
  title: string;
}) {
  return (
    <Paper
      as="article"
      className="paper-sticker-shadow grid min-h-[96px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 font-brand text-ink"
      foldSize={18}
      variant="plain"
    >
      <span className="grid min-w-0">
        <strong className="text-[1.05rem] font-bold leading-[1.4]">
          {title}
        </strong>
        <span className="mt-1 text-[0.78rem] leading-[1.5] text-ink-soft">
          {subtitle}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {links.map(({ className, href, Icon, name }) => (
          <Paper
            animateOnMount={false}
            ariaLabel={`${title} 的 ${name} 主页`}
            className="inline-flex size-11 items-center justify-center no-underline transition-transform duration-150 hover:-translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--focus-ring)]"
            foldSize={8}
            href={href}
            key={href}
            rel="noreferrer"
            target="_blank"
            title={`${title} - ${name}`}
            variant="plain"
          >
            <span className={className} aria-hidden="true">
              <Icon size={22} />
            </span>
          </Paper>
        ))}
      </span>
    </Paper>
  );
}
