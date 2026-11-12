import { PageHeader } from "@/components/layout/PageHeader";
import { SectionHeading } from "@/components/layout/SectionHeading";

const aboutItems = [
  {
    title: "项目定位",
    content:
      "TouhouFlandre 是非官方东方 Project 同人项目。玩家根据初登场作品、年份、种族、阵营、地点和发色反馈逐步缩小范围。",
  },
  {
    title: "数据与隐私",
    content:
      "本地统计使用浏览器存储，不会上传游玩历史。多人房间由服务器维护对局状态，但分享文本和统计导出不会包含房间号、访客令牌或对手昵称。",
  },
  {
    title: "题库与素材",
    content:
      "角色字段用于游戏反馈，不作为设定裁定。素材作者、作品链接与授权说明集中列在友链与鸣谢页面。",
  },
  {
    title: "开源项目",
    content:
      "项目源码、功能计划和问题追踪均在 GitHub 仓库公开。提交题库修正时，请同时提供可核查的资料来源。",
  },
] as const;

export default function AboutPage() {
  return (
    <section className="links-page">
      <PageHeader title="关于本站" />
      {aboutItems.map(({ title, content }) => (
        <section className="mt-9" key={title}>
          <SectionHeading className="mb-4" title={title} />
          <p className="m-0 text-[0.9rem] leading-8 text-ink-soft">{content}</p>
        </section>
      ))}
    </section>
  );
}
