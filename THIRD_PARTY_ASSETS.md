# 第三方素材与授权

本仓库源代码与第三方视觉素材分开授权。仓库的 MIT License 不会重新授权下列素材、商标、角色名称或东方 Project 相关设定。

## 东方全角色像素肖像素材包

| 项目 | 内容 |
|---|---|
| 素材 | 东方全角色像素肖像素材包 |
| 作者 | 苗库里 |
| 作者主页 | https://space.bilibili.com/152309938 |
| 仓库位置 | `apps/web/public/characters` |
| 用途 | 角色头像、搜索结果、猜测历史和答案展示 |
| 允许范围 | 个人及非商业用途，包括同人作品、免费游戏和网站 |
| 仓库处理 | 保留原始编号与角色名称；网站通过 CSS 缩放与裁切展示 |

这些头像版权仍归原作者所有，不适用仓库 MIT License。复用、再分发或迁移到其他项目之前，请确认并遵守作者的使用条件，同时保留署名。

## 首页视觉素材

| 项目 | 内容 |
|---|---|
| 素材 | 首页封面图 |
| 来源 | pixiv 作品 50752377 |
| 来源链接 | https://www.pixiv.net/artworks/50752377 |
| 仓库位置 | `apps/web/public/hero-touhou-collage.jpg` |
| 用途 | 首页首屏背景视觉 |

请勿将该图片从本项目中单独抽取、再分发或用于其他项目。

## 平台图标

| 素材 | 来源 | 许可证 | 仓库位置 |
|---|---|---|---|
| Bilibili Mono icon | https://github.com/lobehub/lobe-icons | MIT | `apps/web/src/components/BilibiliIcon.tsx` |
| pixiv icon | https://simpleicons.org/ | CC0-1.0 | `apps/web/src/components/PixivIcon.tsx` |

Bilibili 与 pixiv 标识仅用于指向对应平台主页。相关商标归各自权利方所有。

## 项目自制图形

| 素材 | 仓库位置 | 说明 |
|---|---|---|
| 站点 favicon SVG | `apps/web/public/favicon.svg` | 项目内自制图形。 |
| 站点 favicon PNG | `apps/web/public/favicon.png` | SVG 的位图版本或配套图标。 |
| 阴阳标记组件 | `apps/web/src/components/YinYangMark.tsx` | 项目内自制 SVG 组件。 |

## 音乐播放器素材

本声明适用于 `apps/web/public/music` 中保存的全部现有及未来音乐、专辑封面、曲目封面和占位图素材。它们仅用于本站音乐播放器，相关著作权及其他权利仍归各自作者、制作方和权利方所有，不自动适用本仓库的 MIT License，也不因进入本仓库而获得重新授权。

每项素材的来源页面和实际本地化地址记录在 `packages/data/src/music` 的曲库 JSON `sourceRefs` 中；运行时路径由同一 JSON 目录中的 `audioUrl`、专辑 `coverUrl` 和校验器约束。

请勿从本项目中单独抽取或再分发这些素材，也不得将其误认为本项目创作、MIT 授权或官方授权资源。TouhouFlandre 仍是非官方同人项目，与任何音乐、封面素材的作者、制作方和权利方不存在隶属或背书关系。

## 东方 Project 声明

TouhouFlandre 是非官方同人项目，与上海爱丽丝幻乐团或任何官方发行方无关。东方 Project 的名称、角色和设定归各自权利方所有。

引入新素材时，必须同步更新本文，记录作者、来源链接、许可证或授权说明、仓库位置和站内用途。来源不明或授权不清的素材不得纳入仓库。
