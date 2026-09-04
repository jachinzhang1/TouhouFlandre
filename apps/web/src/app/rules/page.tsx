import { Paper } from "../../components/Paper";

const rules = [
  {
    title: "反馈怎么读",
    summary: "颜色与图标共同表达字段关系",
    content:
      "命中表示该字段完全一致；部分命中表示集合字段存在交集；更高与更低用于年份等可排序字段；未命中表示没有匹配；未知表示当前资料不足。",
  },
  {
    title: "单人模式",
    summary: "每日题固定，随机题可随时重开",
    content:
      "每日题在同一自然日使用相同答案。随机题从当前出题范围抽取。已提交过的角色不能在同一局重复提交。",
  },
  {
    title: "竞速模式",
    summary: "所有玩家同时竞猜同一答案",
    content:
      "双人竞速按局数决胜；多人竞速可启用积分淘汰。自己的棋盘显示完整内容，对手棋盘仅公开反馈状态，答案始终由服务器判定。",
  },
  {
    title: "接力模式",
    summary: "共享棋盘并按顺序行动",
    content:
      "当前回合玩家可以猜测或空过。主动空过与超时空过共享额度；额度耗尽后再次空过会导致该玩家本局判负。",
  },
] as const;

export default function RulesPage() {
  return (
    <section className="info-page px-[18px] pt-12 pb-8 max-[680px]:pt-8">
      <header className="max-w-[720px] border-b border-line pb-5">
        <p className="mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          RULES
        </p>
        <h1 className="font-brand text-[2.6rem] font-bold leading-tight max-[680px]:text-[2.05rem]">
          游戏规则
        </h1>
        <p className="mt-3 leading-7 text-ink-soft">
          从一次猜测到下一步判断，反馈始终沿同一条路径流动。
        </p>
      </header>

      <div
        className="rules-diagonal-diagram my-8 max-w-[920px]"
        role="img"
        aria-label="选择角色、读取字段反馈、缩小答案范围的三步流程"
      >
        <Paper as="div" className="rules-diagonal-node" foldSize={10} pattern>
          <small>01</small>
          <strong>选择角色</strong>
          <span>输入名称或别名</span>
        </Paper>
        <Paper as="div" className="rules-diagonal-node" foldSize={10} pattern>
          <small>02</small>
          <strong>读取反馈</strong>
          <span>比较七项公开字段</span>
        </Paper>
        <Paper as="div" className="rules-diagonal-node" foldSize={10} pattern>
          <small>03</small>
          <strong>缩小范围</strong>
          <span>继续推理直至命中</span>
        </Paper>
      </div>

      <div className="grid max-w-[920px] gap-3">
        {rules.map((rule) => (
          <Paper
            as="article"
            className="info-disclosure-card p-0"
            foldSize={12}
            key={rule.title}
            unfoldOnHover={false}
            pattern
          >
            <details>
              <summary className="cursor-pointer px-4 py-4 marker:content-none">
                <strong className="block text-base text-ink">
                  {rule.title}
                </strong>
                <span className="mt-1 block text-xs text-ink-soft">
                  {rule.summary}
                </span>
              </summary>
              <p className="m-0 border-t border-dashed border-line px-4 py-4 text-sm leading-7 text-ink-soft">
                {rule.content}
              </p>
            </details>
          </Paper>
        ))}
      </div>
    </section>
  );
}
