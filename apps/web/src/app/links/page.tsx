import type { ReactNode } from "react";
import { SiBilibili, SiGithub, SiPixiv } from "@icons-pack/react-simple-icons";
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
  bilibili: "brand-icon-bilibili",
  github: "brand-icon-github",
  pixiv: "brand-icon-pixiv",
} as const;

const assetCredits = [
  {
    title: "苗库里 - 东方像素肖像素材包",
    avatarUrl:
      "https://i1.hdslb.com/bfs/face/1672120a2cd546f9046f33abde0f5f388e810b5c.jpg@160w_160h_1c_1s.webp",
    subtitle: "东方全角色像素肖像素材包原作者",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/152309938",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    title: "うらないし - Pixiv 作品 50752377",
    subtitle: "首页视觉素材来源",
    links: [
      {
        name: "Pixiv",
        href: "https://www.pixiv.net/artworks/50752377",
        Icon: SiPixiv,
        className: platformStyles.pixiv,
      },
    ],
  },
];

const developers: Array<{
  avatarUrl?: string;
  name: string;
  role: string;
  links: Platform[];
}> = [
  {
    name: "Vitamin X",
    avatarUrl: "https://avatars.githubusercontent.com/u/59960003?s=160&v=4",
    role: "核心功能开发",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/jachinzhang1",
        Icon: SiGithub,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/518197475",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "常乐凯特",
    avatarUrl: "https://avatars.githubusercontent.com/u/118893731?s=160&v=4",
    role: "核心功能开发",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/ChangleCat",
        Icon: SiGithub,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/313519315",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "KrLite",
    avatarUrl: "https://avatars.githubusercontent.com/u/68179735?s=160&v=4",
    role: "前端开发与UX设计",
    links: [
      {
        name: "GitHub",
        href: "https://github.com/KrLite",
        Icon: SiGithub,
        className: platformStyles.github,
      },
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/399487383",
        Icon: SiBilibili,
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
        Icon: SiPixiv,
        className: platformStyles.pixiv,
      },
    ],
  },
  {
    name: "存在的虚无",
    avatarUrl:
      "https://i1.hdslb.com/bfs/face/e9c4a7ca6259c6f1f193fee422e51edfc9180fbb.webp@160w_160h_1c_1s.webp",
    role: "数据校对、站点推广",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/452230036",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "赤色侠盗",
    avatarUrl:
      "https://i2.hdslb.com/bfs/face/6be4cbcd861067b97e53ebf5f894de5ee0c8852d.jpg@160w_160h_1c_1s.webp",
    role: "数据校对",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/387814829",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
  {
    name: "陌望",
    avatarUrl:
      "https://i1.hdslb.com/bfs/face/af61b97e617171a4383a4c3fb9ca24d9839e7e53.jpg@160w_160h_1c_1s.webp",
    role: "站点推广",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/3546908777777221",
        Icon: SiBilibili,
        className: platformStyles.bilibili,
      },
    ],
  },
];

const friendLinks = [
  {
    title: "西电 Shining 动漫社",
    avatarUrl:
      "https://i2.hdslb.com/bfs/face/590cea03dbeb3f4b47aa5fe53e53b31c088ad5ed.jpg@160w_160h_1c_1s.webp",
    subtitle: "西电 Shining 动漫社官方哔哩哔哩空间",
    links: [
      {
        name: "Bilibili",
        href: "https://space.bilibili.com/30032438",
        Icon: SiBilibili,
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
              avatarUrl={developer.avatarUrl}
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
  avatarUrl,
  links,
  subtitle,
  title,
}: {
  avatarUrl?: string;
  links: Platform[];
  subtitle: string;
  title: string;
}) {
  return (
    <Paper
      as="article"
      className="credit-entry-card paper-sticker-shadow grid min-h-[96px] grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 p-4 font-brand text-ink"
      foldSize={18}
      variant="plain"
    >
      <span className="credit-avatar" aria-hidden="true">
        {avatarUrl ? (
          <img
            alt=""
            decoding="async"
            referrerPolicy="no-referrer"
            src={avatarUrl}
          />
        ) : null}
      </span>
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
          <a
            aria-label={`${title} 的 ${name} 主页`}
            className={`brand-icon-link ${className} inline-flex size-11 items-center justify-center no-underline hover:-translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--focus-ring)]`}
            href={href}
            key={href}
            rel="noreferrer"
            target="_blank"
            title={`${title} - ${name}`}
          >
            <Icon size={22} aria-hidden="true" />
          </a>
        ))}
      </span>
    </Paper>
  );
}
