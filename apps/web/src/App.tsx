import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ExternalLink,
  Flower2,
  Home,
  Megaphone,
  Search,
  Shield,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  GAME_CONTENT_DEFINITIONS,
  isSinglePlayerGameMode,
} from "@touhoufriberg/shared";
import type { SinglePlayerGameMode } from "@touhoufriberg/shared";
import { BilibiliIcon } from "./components/BilibiliIcon";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "./gameModes";
import { useCatalogSummary } from "./hooks/useCatalogSummary";
import { SearchPage } from "./pages/SearchPage";
import { SingleGamePage } from "./pages/SingleGamePage";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;

type Route =
  | { name: "home" }
  | { name: "search" }
  | { name: "singleLobby" }
  | { name: "singleGame"; mode: SinglePlayerGameMode }
  | { name: "multiLobby" }
  | { name: "multiRoom" }
  | { name: "stats" }
  | { name: "leaderboard" }
  | { name: "announcement" }
  | { name: "links" }
  | { name: "admin" }
  | { name: "notFound" };

const parseRoute = (pathname: string): Route => {
  if (pathname === "/") return { name: "home" };
  if (pathname === "/search") return { name: "search" };
  if (pathname === "/single") return { name: "singleLobby" };
  const singleMode = pathname.match(/^\/single\/([^/]+)$/)?.[1];
  if (singleMode && isSinglePlayerGameMode(singleMode))
    return { name: "singleGame", mode: singleMode };
  if (pathname === "/multi") return { name: "multiLobby" };
  if (pathname === "/multi/room") return { name: "multiRoom" };
  if (pathname === "/stats") return { name: "stats" };
  if (pathname === "/leaderboard") return { name: "leaderboard" };
  if (pathname === "/announcement") return { name: "announcement" };
  if (pathname === "/links") return { name: "links" };
  if (pathname === "/admin") return { name: "admin" };
  return { name: "notFound" };
};

const routePath = (route: Route) => {
  if (route.name === "home") return "/";
  if (route.name === "search") return "/search";
  if (route.name === "singleLobby") return "/single";
  if (route.name === "singleGame") return `/single/${route.mode}`;
  if (route.name === "multiLobby") return "/multi";
  if (route.name === "multiRoom") return "/multi/room";
  if (route.name === "stats") return "/stats";
  if (route.name === "leaderboard") return "/leaderboard";
  if (route.name === "announcement") return "/announcement";
  if (route.name === "links") return "/links";
  if (route.name === "admin") return "/admin";
  return "/404";
};

function useRouter() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname),
  );

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextRoute: Route) => {
    const path = routePath(nextRoute);
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
  };

  return { route, navigate };
}

function SiteFrame({
  route,
  navigate,
  children,
}: {
  route: Route;
  navigate: (route: Route) => void;
  children: React.ReactNode;
}) {
  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: "首页", route: { name: "home" }, icon: Home },
    { label: "游戏", route: { name: "singleLobby" }, icon: CalendarDays },
    { label: "搜索", route: { name: "search" }, icon: Search },
    { label: "统计", route: { name: "stats" }, icon: BarChart3 },
    { label: "排行", route: { name: "leaderboard" }, icon: Trophy },
    { label: "公告", route: { name: "announcement" }, icon: Megaphone },
  ];

  return (
    <div className="app-shell">
      <nav className="site-nav" aria-label="站点导航">
        <button
          className="brand-button"
          type="button"
          onClick={() => navigate({ name: "home" })}
          aria-label="返回首页"
        >
          <span className="brand-mark" aria-hidden="true">
            <Flower2 size={18} />
          </span>
          <span className="brand-copy">
            <strong>TouhouFlandre</strong>
            <small>东方芙一把</small>
          </span>
        </button>
        <div className="nav-links">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              route.name === item.route.name ||
              (item.route.name === "singleLobby" &&
                (route.name === "singleGame" ||
                  route.name === "multiLobby" ||
                  route.name === "multiRoom"));
            return (
              <button
                className={active ? "nav-link active" : "nav-link"}
                key={item.label}
                type="button"
                onClick={() => navigate(item.route)}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <main className="page-content">{children}</main>
      <footer className="site-footer">
        <span>TouhouFlandre · 非官方东方 Project 同人项目</span>
        <button type="button" onClick={() => navigate({ name: "links" })}>
          友链与鸣谢
        </button>
      </footer>
    </div>
  );
}

function HomePage({ navigate }: { navigate: (route: Route) => void }) {
  const catalog = useCatalogSummary();
  const characterSummary = catalog?.contents.find(
    (entry) => entry.contentType === "character",
  );

  return (
    <>
      <section className="hero-page">
        <div className="hero-content">
          <p className="hero-status">
            <span aria-hidden="true" /> 今日题已开放
          </p>
          <h1>东方角色芙一把</h1>
          <p className="hero-lead">
            从初登场作品、年份、种族、阵营、地点和头发颜色里一点点缩小范围，猜出今天的东方角色。
          </p>
          <div className="hero-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => navigate({ name: "singleGame", mode: "daily" })}
            >
              <CalendarDays size={18} aria-hidden="true" />
              <span>开始每日题</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate({ name: "singleLobby" })}
            >
              <Shuffle size={18} aria-hidden="true" />
              <span>其他模式</span>
            </button>
          </div>
          <div className="hero-meta" aria-label="今日题信息">
            <span>
              <strong>{CHARACTER_GAME.maxGuesses}</strong> 次机会
            </span>
            <span>
              <strong>
                {CHARACTER_GAME.fields.filter((field) => field.visible).length}
              </strong>{" "}
              项线索
            </span>
            <span>
              <strong>{characterSummary?.guessable ?? "-"}</strong> 名角色
            </span>
          </div>
        </div>
      </section>
      <section className="home-quickbar" aria-label="快捷入口">
        <Feature
          icon={CalendarDays}
          eyebrow="今日挑战"
          title="每日题"
          text="与所有玩家面对同一名角色"
          onClick={() => navigate({ name: "singleGame", mode: "daily" })}
        />
        <Feature
          icon={Shuffle}
          eyebrow="自由练习"
          title="随机题"
          text="随时开始一局新的推理"
          onClick={() => navigate({ name: "singleGame", mode: "random" })}
        />
        <Feature
          icon={Search}
          eyebrow="角色资料"
          title="题库索引"
          text="按名称、别名或作品检索"
          onClick={() => navigate({ name: "search" })}
        />
      </section>
    </>
  );
}

function Feature({
  icon: Icon,
  eyebrow,
  title,
  text,
  onClick,
}: {
  icon: typeof Search;
  eyebrow: string;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button className="quick-link" type="button" onClick={onClick}>
      <span className="quick-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="quick-copy">
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" />
    </button>
  );
}

function SingleLobby({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <section className="page-panel">
      <div className="page-heading">
        <p className="kicker">PLAY</p>
        <h1>游戏模式</h1>
        <p>选择一局，沿着角色留下的线索抵达答案。</p>
      </div>
      <div className="mode-choice-grid">
        {SINGLE_PLAYER_MODE_IDS.map((modeId) => {
          const config = modeConfig[modeId];
          const Icon = config.icon;
          return (
            <button
              className="mode-choice"
              key={modeId}
              type="button"
              onClick={() => navigate({ name: "singleGame", mode: modeId })}
            >
              <span className="mode-choice-top">
                <span className="mode-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <small className={`mode-state ${config.stateClass}`.trim()}>
                  {config.stateLabel}
                </small>
              </span>
              <span className="mode-title">
                <strong>{config.label}</strong>
                <ArrowRight size={20} aria-hidden="true" />
              </span>
              <span>{config.description}</span>
            </button>
          );
        })}
        <button
          className="mode-choice"
          type="button"
          onClick={() => navigate({ name: "multiLobby" })}
        >
          <span className="mode-choice-top">
            <span className="mode-icon">
              <Users size={22} aria-hidden="true" />
            </span>
            <small className="mode-state muted">暂未开放</small>
          </span>
          <span className="mode-title">
            <strong>多人大厅</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>与好友在同一个房间中共同推理。</span>
        </button>
        <button
          className="mode-choice"
          type="button"
          onClick={() => navigate({ name: "multiRoom" })}
        >
          <span className="mode-choice-top">
            <span className="mode-icon">
              <Shield size={22} aria-hidden="true" />
            </span>
            <small className="mode-state muted">暂未开放</small>
          </span>
          <span className="mode-title">
            <strong>多人房间</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>通过房间码加入已创建的对局。</span>
        </button>
      </div>
    </section>
  );
}

function PlaceholderPage({
  title,
  eyebrow,
  text,
  icon: Icon,
}: {
  title: string;
  eyebrow: string;
  text: string;
  icon: typeof Users;
}) {
  return (
    <section className="page-panel placeholder">
      <span className="placeholder-icon">
        <Icon size={28} aria-hidden="true" />
      </span>
      <div className="page-heading compact">
        <p className="kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
        <span className="availability">暂未开放</span>
      </div>
    </section>
  );
}

function LinksPage() {
  return (
    <section className="page-panel links-page">
      <div className="page-heading">
        <p className="kicker">LINKS & CREDITS</p>
        <h1>友链与鸣谢</h1>
        <p>感谢为本项目提供创作资源与帮助的作者。</p>
      </div>
      <div className="friend-links">
        <a
          className="friend-link"
          href="https://space.bilibili.com/152309938"
          target="_blank"
          rel="noreferrer"
        >
          <span className="friend-link-icon" aria-hidden="true">
            <BilibiliIcon size={28} />
          </span>
          <span className="friend-link-copy">
            <small>像素肖像素材</small>
            <strong>苗库里 - 哔哩哔哩个人空间</strong>
            <span>东方全角色像素肖像素材包原作者</span>
          </span>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      </div>
      <p className="asset-note">
        本项目中的角色像素头像经作者开放用于个人及非商业用途，包括同人作品、免费游戏与网站。素材版权归原作者所有。
      </p>
    </section>
  );
}

export function App() {
  const { route, navigate } = useRouter();

  let content: React.ReactNode;
  if (route.name === "home") content = <HomePage navigate={navigate} />;
  else if (route.name === "search") content = <SearchPage />;
  else if (route.name === "singleLobby")
    content = <SingleLobby navigate={navigate} />;
  else if (route.name === "singleGame")
    content = (
      <SingleGamePage
        mode={route.mode}
        onModeChange={(mode) => navigate({ name: "singleGame", mode })}
      />
    );
  else if (route.name === "multiLobby")
    content = (
      <PlaceholderPage
        icon={Users}
        eyebrow="MULTIPLAYER"
        title="多人大厅"
        text="实时房间与邀请功能正在建设中。"
      />
    );
  else if (route.name === "multiRoom")
    content = (
      <PlaceholderPage
        icon={Users}
        eyebrow="ROOM"
        title="多人房间"
        text="房间状态与同步对局将在后续版本开放。"
      />
    );
  else if (route.name === "stats")
    content = (
      <PlaceholderPage
        icon={BarChart3}
        eyebrow="STATS"
        title="统计"
        text="游玩次数、胜率与猜测分布正在建设中。"
      />
    );
  else if (route.name === "leaderboard")
    content = (
      <PlaceholderPage
        icon={Trophy}
        eyebrow="LEADERBOARD"
        title="排行榜"
        text="每日题排行将在数据校验机制完成后开放。"
      />
    );
  else if (route.name === "announcement")
    content = (
      <PlaceholderPage
        icon={Megaphone}
        eyebrow="ANNOUNCEMENTS"
        title="公告"
        text="当前暂无公告。"
      />
    );
  else if (route.name === "links") content = <LinksPage />;
  else if (route.name === "admin")
    content = (
      <PlaceholderPage
        icon={Shield}
        eyebrow="ADMIN"
        title="管理后台"
        text="该区域仅面向授权维护者。"
      />
    );
  else
    content = (
      <PlaceholderPage
        icon={Search}
        eyebrow="404"
        title="页面不存在"
        text="这个地址暂时没有对应页面。"
      />
    );

  return (
    <SiteFrame route={route} navigate={navigate}>
      {content}
    </SiteFrame>
  );
}
