import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
  ExternalLink,
  Flower2,
  Home,
  Loader2,
  Megaphone,
  Minus,
  RotateCcw,
  Search,
  Shield,
  Shuffle,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createShareText,
  GAME_CONTENT_DEFINITIONS,
  HAIR_COLOR_LABELS,
  isSinglePlayerGameMode,
} from "@touhoufriberg/shared";
import type {
  FieldFeedback,
  PublicGameSession,
  SinglePlayerGameMode,
} from "@touhoufriberg/shared";
import { requestJson } from "./api";
import { BilibiliIcon } from "./components/BilibiliIcon";
import { CharacterAvatar } from "./components/CharacterAvatar";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "./gameModes";
import { useCatalogSummary } from "./hooks/useCatalogSummary";
import { useCharacterSearch } from "./hooks/useCharacterSearch";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;
const GAME_SEARCH_RESULT_LIMIT = 12;

type PuzzleResponse = {
  puzzleLabel: string;
  session: PublicGameSession;
};

type GuessResponse = {
  session: PublicGameSession;
};

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

const feedbackClass = (feedback: FieldFeedback) =>
  `feedback feedback-${feedback.status}`;
const formatFeedbackValue = (feedback: FieldFeedback) =>
  feedback.displayValue.join("、");

function FeedbackIcon({ feedback }: { feedback: FieldFeedback }) {
  if (feedback.status === "exact")
    return <Check size={14} aria-label="完全匹配" />;
  if (feedback.status === "partial")
    return <Minus size={14} aria-label="部分匹配" />;
  if (feedback.status === "higher")
    return <ChevronsUp size={14} aria-label="答案更晚" />;
  if (feedback.status === "lower")
    return <ChevronsDown size={14} aria-label="答案更早" />;
  return <X size={14} aria-label="不匹配" />;
}

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

function SearchPage() {
  const [query, setQuery] = useState("");
  const { error, loading, results, total } = useCharacterSearch(query);

  return (
    <section className="page-panel" aria-busy={loading}>
      <div className="page-heading">
        <p className="kicker">ARCHIVE</p>
        <h1>角色搜索</h1>
        <p>浏览当前题库中的可猜角色。</p>
      </div>
      <label className="search-box standalone">
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如 灵梦 / Reimu / 红白"
        />
      </label>
      {error ? <p className="message error">{error}</p> : null}
      <div className="result-summary">
        <strong>{total}</strong>
        <span>条结果</span>
      </div>
      <div className="candidate-list page-candidates">
        {results.map((result) => (
          <article className="candidate static" key={result.id}>
            <CharacterAvatar
              avatarUrl={result.avatarUrl}
              name={result.name}
              initials={result.initials}
            />
            <span className="candidate-copy">
              <strong>{result.name}</strong>
              <small>
                {result.subtitle} · 发色{" "}
                {result.hairColors
                  .map((color) => HAIR_COLOR_LABELS[color])
                  .join("、")}
              </small>
            </span>
          </article>
        ))}
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

function SingleGame({
  mode,
  navigate,
}: {
  mode: SinglePlayerGameMode;
  navigate: (route: Route) => void;
}) {
  const [session, setSession] = useState<PublicGameSession | null>(null);
  const [puzzleLabel, setPuzzleLabel] = useState(modeConfig[mode].puzzleLabel);
  const [query, setQuery] = useState("");
  const { error: searchError, results } = useCharacterSearch(query, {
    limit: GAME_SEARCH_RESULT_LIMIT,
  });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const guessedIds = useMemo(
    () => new Set(session?.guesses.map((guess) => guess.guessId) ?? []),
    [session],
  );
  const isFinished = session?.status === "won" || session?.status === "lost";
  const showSuggestions =
    searchFocused &&
    query.trim().length > 0 &&
    !isFinished &&
    results.length > 0;

  const persistSession = (
    nextMode: SinglePlayerGameMode,
    nextSession: PublicGameSession,
  ) => {
    localStorage.setItem(modeConfig[nextMode].storageKey, nextSession.id);
  };

  const loadSession = async (nextMode: SinglePlayerGameMode) => {
    setLoading(true);
    setMessage("");
    setShareMessage("");

    try {
      const storedSessionId = localStorage.getItem(
        modeConfig[nextMode].storageKey,
      );
      if (storedSessionId) {
        try {
          const restored = await requestJson<GuessResponse>(
            `/api/sessions/${storedSessionId}`,
          );
          setSession(restored.session);
          setPuzzleLabel(modeConfig[nextMode].puzzleLabel);
          return;
        } catch {
          localStorage.removeItem(modeConfig[nextMode].storageKey);
        }
      }

      const created = await requestJson<PuzzleResponse>(
        modeConfig[nextMode].createPath,
        { method: "POST" },
      );
      setSession(created.session);
      setPuzzleLabel(created.puzzleLabel);
      persistSession(nextMode, created.session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载游戏失败。");
    } finally {
      setLoading(false);
    }
  };

  const startFresh = async (nextMode = mode) => {
    localStorage.removeItem(modeConfig[nextMode].storageKey);
    await loadSession(nextMode);
  };

  useEffect(() => {
    void loadSession(mode);
  }, [mode]);

  const submitGuess = async (guessId = selectedId) => {
    if (!session || !guessId || submitting || isFinished) return;
    setSubmitting(true);
    setMessage("");
    setShareMessage("");

    try {
      const payload = await requestJson<GuessResponse>(
        `/api/sessions/${session.id}/guess`,
        {
          method: "POST",
          body: JSON.stringify({ guessId }),
        },
      );
      setSession(payload.session);
      persistSession(mode, payload.session);
      setQuery("");
      setSelectedId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const copyShare = async () => {
    if (!session) return;
    const text = createShareText(session, puzzleLabel, window.location.origin);
    await navigator.clipboard.writeText(text);
    setShareMessage("分享文本已复制。");
  };

  return (
    <>
      <section className="game-surface" aria-label="TouhouFlandre 游戏区域">
        <header className="topbar">
          <div className="game-title">
            <span className="game-emblem">
              <Flower2 size={22} aria-hidden="true" />
            </span>
            <div>
              <p className="kicker">{modeConfig[mode].eyebrow}</p>
              <h1>东方角色芙一把</h1>
            </div>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="游戏模式">
            {SINGLE_PLAYER_MODE_IDS.map((modeKey) => {
              const Icon = modeConfig[modeKey].icon;
              return (
                <button
                  className={mode === modeKey ? "mode-tab active" : "mode-tab"}
                  key={modeKey}
                  type="button"
                  onClick={() =>
                    navigate({ name: "singleGame", mode: modeKey })
                  }
                  title={modeConfig[modeKey].label}
                  aria-selected={mode === modeKey}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{modeConfig[modeKey].label}</span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="status-strip">
          <div className="puzzle-status">
            <span className="label">题目</span>
            <strong>{puzzleLabel}</strong>
            <span className="progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${((session?.guesses.length ?? 0) / (session?.maxGuesses ?? CHARACTER_GAME.maxGuesses)) * 100}%`,
                }}
              />
            </span>
          </div>
          <div>
            <span className="label">进度</span>
            <strong>
              {session?.guesses.length ?? 0}/
              {session?.maxGuesses ?? CHARACTER_GAME.maxGuesses}
            </strong>
          </div>
          <div>
            <span className="label">状态</span>
            <strong className={`session-state ${session?.status ?? "playing"}`}>
              {session?.status === "won"
                ? "已猜中"
                : session?.status === "lost"
                  ? "未猜中"
                  : "进行中"}
            </strong>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void startFresh()}
            title="重新开始"
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
        </div>

        <form
          className="guess-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitGuess();
          }}
        >
          <div className="search-combobox">
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onFocus={() => setSearchFocused(true)}
                onBlur={() =>
                  window.setTimeout(() => setSearchFocused(false), 120)
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                }}
                disabled={loading || submitting || isFinished}
                placeholder="输入角色名、别名或初登场作品"
                aria-label="搜索东方角色"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
              />
            </label>
            {showSuggestions ? (
              <div
                className="suggestion-list"
                role="listbox"
                aria-label="搜索建议"
              >
                {results.map((result) => {
                  const disabled = guessedIds.has(result.id);
                  return (
                    <button
                      className={
                        selectedId === result.id
                          ? "suggestion selected"
                          : "suggestion"
                      }
                      key={result.id}
                      type="button"
                      disabled={disabled}
                      role="option"
                      aria-selected={selectedId === result.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSelectedId(result.id);
                        setQuery(result.name);
                        setSearchFocused(false);
                      }}
                    >
                      <CharacterAvatar
                        avatarUrl={result.avatarUrl}
                        name={result.name}
                        initials={result.initials}
                        className="suggestion-avatar"
                      />
                      <span className="suggestion-main">
                        <strong>{result.name}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                      <span className="suggestion-meta">
                        {disabled
                          ? "已猜"
                          : result.hairColors
                              .map((color) => HAIR_COLOR_LABELS[color])
                              .join("、")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={!selectedId || loading || submitting || isFinished}
          >
            {submitting ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            <span>提交猜测</span>
          </button>
        </form>

        {message || searchError ? (
          <p className="message error">{message || searchError}</p>
        ) : null}
        {shareMessage ? (
          <p className="message success">{shareMessage}</p>
        ) : null}

        <div className="table-wrap">
          <table className="guess-table">
            <thead>
              <tr>
                <th>角色</th>
                {CHARACTER_GAME.fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {session?.guesses.length ? (
                session.guesses.map((guess, index) => (
                  <tr
                    key={guess.guessId}
                    style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}
                  >
                    <th scope="row">
                      <span className="guess-character">
                        <CharacterAvatar
                          avatarUrl={guess.guessAvatarUrl}
                          name={guess.guessName}
                          initials={guess.guessName.slice(0, 2)}
                          className="guess-avatar"
                        />
                        <span>{guess.guessName}</span>
                      </span>
                    </th>
                    {guess.feedback.map((feedback) => (
                      <td key={feedback.field}>
                        <span
                          className={feedbackClass(feedback)}
                          title={`${feedback.label}: ${feedback.status}`}
                        >
                          <b>
                            <FeedbackIcon feedback={feedback} />
                          </b>
                          <span>{formatFeedbackValue(feedback)}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="empty-state"
                    colSpan={CHARACTER_GAME.fields.length + 1}
                  >
                    {loading ? (
                      <span>
                        <Loader2
                          className="spin"
                          size={20}
                          aria-hidden="true"
                        />{" "}
                        正在连接本地题库
                      </span>
                    ) : (
                      <span>
                        <Search size={20} aria-hidden="true" /> 等待第一次猜测
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {session && isFinished ? (
        <aside className="result-panel" aria-label="游戏结果">
          <div>
            <p className="kicker">
              {session.status === "won" ? "Clear" : "Failed"}
            </p>
            <h2>{session.status === "won" ? "猜中了" : "答案揭晓"}</h2>
            <p>
              答案是 <strong>{session.answer?.names.zhHans}</strong>，共使用{" "}
              {session.guesses.length} 次猜测。
            </p>
          </div>
          {session.answer ? (
            <CharacterAvatar
              avatarUrl={session.answer.avatarUrl}
              name={session.answer.names.zhHans}
              initials={session.answer.names.zhHans.slice(0, 2)}
              className="answer-token"
            />
          ) : null}
          <div className="result-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyShare()}
            >
              <Copy size={18} aria-hidden="true" />
              <span>复制分享</span>
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void startFresh()}
            >
              <RotateCcw size={18} aria-hidden="true" />
              <span>再来一局</span>
            </button>
          </div>
        </aside>
      ) : null}
    </>
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
    content = <SingleGame mode={route.mode} navigate={navigate} />;
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
