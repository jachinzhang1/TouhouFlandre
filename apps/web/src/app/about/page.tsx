import { Database, Github, HeartHandshake, ShieldCheck } from "lucide-react";
import { Paper } from "../../components/Paper";

const aboutItems = [
  {
    title: "项目定位",
    summary: "东方 Project 角色推理游戏",
    Icon: HeartHandshake,
    content:
      "TouhouFlandre 是非官方东方 Project 同人项目。玩家根据初登场作品、年份、种族、阵营、地点和发色反馈逐步缩小范围。",
  },
  {
    title: "数据与隐私",
    summary: "游玩统计仅保存在当前浏览器",
    Icon: ShieldCheck,
    content:
      "本地统计使用浏览器存储，不会上传游玩历史。多人房间由服务器维护对局状态，但分享文本和统计导出不会包含房间号、访客令牌或对手昵称。",
  },
  {
    title: "题库与素材",
    summary: "角色资料与素材来源独立记录",
    Icon: Database,
    content:
      "角色字段用于游戏反馈，不作为设定裁定。素材作者、作品链接与授权说明集中列在友链与鸣谢页面。",
  },
  {
    title: "开源项目",
    summary: "代码与问题反馈公开维护",
    Icon: Github,
    content:
      "项目源码、功能计划和问题追踪均在 GitHub 仓库公开。提交题库修正时，请同时提供可核查的资料来源。",
  },
] as const;

export default function AboutPage() {
  return (
    <section className="info-page px-[18px] pt-12 pb-8 max-[680px]:pt-8">
      <header className="max-w-[720px] border-b border-line pb-5">
        <p className="mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          ABOUT
        </p>
        <h1 className="font-brand text-[2.6rem] font-bold leading-tight max-[680px]:text-[2.05rem]">
          关于本站
        </h1>
        <p className="mt-3 leading-7 text-ink-soft">
          分项了解项目定位、数据边界与素材来源。
        </p>
      </header>

      <div className="mt-5 grid max-w-[920px] grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        {aboutItems.map(({ title, summary, Icon, content }) => (
          <Paper
            as="article"
            className="info-disclosure-card min-h-[112px] p-0"
            foldSize={12}
            key={title}
            pattern
            unfoldOnHover={false}
          >
            <details>
              <summary className="grid cursor-pointer grid-cols-[38px_minmax(0,1fr)] items-center gap-3 px-4 py-4 marker:content-none">
                <span className="inline-flex size-[38px] items-center justify-center rounded-[5px] bg-vermilion-soft text-vermilion">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="grid min-w-0 gap-1">
                  <strong className="text-base text-ink">{title}</strong>
                  <span className="text-xs leading-5 text-ink-soft">
                    {summary}
                  </span>
                </span>
              </summary>
              <p className="m-0 border-t border-dashed border-line px-4 py-4 text-sm leading-7 text-ink-soft">
                {content}
              </p>
            </details>
          </Paper>
        ))}
      </div>
    </section>
  );
}
