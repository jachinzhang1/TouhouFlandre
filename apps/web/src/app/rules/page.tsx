import { PageHeader } from "@/components/layout/PageHeader";
import { SectionHeading } from "@/components/layout/SectionHeading";

const rules = [
  {
    title: "反馈怎么读",
    content:
      "命中表示该字段完全一致；部分命中表示集合字段存在交集；更高与更低用于年份等可排序字段；未命中表示没有匹配；未知表示当前资料不足。",
  },
  {
    title: "单人模式",
    content:
      "每日题在同一自然日使用相同答案。随机题从当前出题范围抽取。已提交过的角色不能在同一局重复提交。",
  },
  {
    title: "竞速模式",
    content:
      "双人竞速按局数决胜；多人竞速可启用积分淘汰。自己的棋盘显示完整内容，对手棋盘仅公开反馈状态，答案始终由服务器判定。",
  },
  {
    title: "接力模式",
    content:
      "当前回合玩家可以猜测或空过。主动空过与超时空过共享额度；额度耗尽后再次空过会导致该玩家本局判负。",
  },
] as const;

export default function RulesPage() {
  return (
    <section className="links-page">
      <PageHeader title="游戏规则" />
      {rules.map(({ title, content }) => (
        <section className="mt-9" key={title}>
          <SectionHeading className="mb-4" title={title} />
          <p className="m-0 text-[0.9rem] leading-8 text-ink-soft">{content}</p>
        </section>
      ))}
    </section>
  );
}
