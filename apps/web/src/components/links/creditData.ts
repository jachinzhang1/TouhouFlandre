import type { ReactNode } from "react";
import { SiBilibili, SiGithub, SiPixiv } from "@icons-pack/react-simple-icons";

type IconComponent = (props: {
  "aria-hidden"?: boolean | "true" | "false";
  size?: number;
}) => ReactNode;

export type CreditPlatform = {
  name: string;
  href: string;
  Icon: IconComponent;
  className: string;
};

export type CreditEntry = {
  avatarUrl?: string;
  links: CreditPlatform[];
  subtitle: string;
  title: string;
};

export type CreditSectionDefinition = {
  entries: CreditEntry[];
  title: string;
};

const platformStyles = {
  bilibili: "brand-icon-bilibili",
  github: "brand-icon-github",
  pixiv: "brand-icon-pixiv",
} as const;

export const creditSections: CreditSectionDefinition[] = [
  {
    title: "素材提供",
    entries: [
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
    ],
  },
  {
    title: "开发者",
    entries: [
      {
        title: "Vitamin X",
        avatarUrl: "https://avatars.githubusercontent.com/u/59960003?s=160&v=4",
        subtitle: "核心功能开发",
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
        title: "常乐凯特",
        avatarUrl:
          "https://avatars.githubusercontent.com/u/118893731?s=160&v=4",
        subtitle: "核心功能开发",
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
        title: "KrLite",
        avatarUrl: "https://avatars.githubusercontent.com/u/68179735?s=160&v=4",
        subtitle: "前端开发与UX设计",
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
        title: "哲狗",
        subtitle: "基础设施提供",
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
        title: "存在的虚无",
        avatarUrl:
          "https://i1.hdslb.com/bfs/face/e9c4a7ca6259c6f1f193fee422e51edfc9180fbb.webp@160w_160h_1c_1s.webp",
        subtitle: "数据校对、站点推广",
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
        title: "赤色侠盗",
        avatarUrl:
          "https://i2.hdslb.com/bfs/face/6be4cbcd861067b97e53ebf5f894de5ee0c8852d.jpg@160w_160h_1c_1s.webp",
        subtitle: "数据校对",
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
        title: "陌望",
        avatarUrl:
          "https://i1.hdslb.com/bfs/face/af61b97e617171a4383a4c3fb9ca24d9839e7e53.jpg@160w_160h_1c_1s.webp",
        subtitle: "站点推广",
        links: [
          {
            name: "Bilibili",
            href: "https://space.bilibili.com/3546908777777221",
            Icon: SiBilibili,
            className: platformStyles.bilibili,
          },
        ],
      },
    ],
  },
  {
    title: "友情链接",
    entries: [
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
    ],
  },
];
