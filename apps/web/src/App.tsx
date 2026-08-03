import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
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
  GUESS_FIELDS,
  HAIR_COLOR_LABELS,
} from "@touhoufriberg/shared";
import type {
  CharacterSearchResult,
  FieldFeedback,
  GameMode,
  PublicGameSession,
} from "@touhoufriberg/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const DAILY_STORAGE_KEY = "touhoufriberg:daily-session";
const RANDOM_STORAGE_KEY = "touhoufriberg:random-session";

type PuzzleResponse = {
  puzzleLabel: string;
  session: PublicGameSession;
};

type SearchResponse = {
  results: CharacterSearchResult[];
};

type GuessResponse = {
  session: PublicGameSession;
};

type Route =
  | { name: "home" }
  | { name: "search" }
  | { name: "singleLobby" }
  | { name: "singleGame"; mode: Exclude<GameMode, "multiplayer"> }
  | { name: "multiLobby" }
  | { name: "multiRoom" }
  | { name: "stats" }
  | { name: "leaderboard" }
  | { name: "announcement" }
  | { name: "admin" }
  | { name: "notFound" };

const modeConfig: Record<
  Exclude<GameMode, "multiplayer">,
  { label: string; icon: typeof CalendarDays; storageKey: string }
> = {
  daily: { label: "每日题", icon: CalendarDays, storageKey: DAILY_STORAGE_KEY },
  random: { label: "随机题", icon: Shuffle, storageKey: RANDOM_STORAGE_KEY },
};

const requestJson = async <T,>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败。");
  }
  return payload as T;
};

const parseRoute = (pathname: string): Route => {
  if (pathname === "/") return { name: "home" };
  if (pathname === "/search") return { name: "search" };
  if (pathname === "/single") return { name: "singleLobby" };
  if (pathname === "/single/daily")
    return { name: "singleGame", mode: "daily" };
  if (pathname === "/single/random")
    return { name: "singleGame", mode: "random" };
  if (pathname === "/multi") return { name: "multiLobby" };
  if (pathname === "/multi/room") return { name: "multiRoom" };
  if (pathname === "/stats") return { name: "stats" };
  if (pathname === "/leaderboard") return { name: "leaderboard" };
  if (pathname === "/announcement") return { name: "announcement" };
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
            <small>幻想乡角色推理</small>
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
        <button
          type="button"
          onClick={() => navigate({ name: "announcement" })}
        >
          站点公告
        </button>
      </footer>
    </div>
  );
}

function HomePage({ navigate }: { navigate: (route: Route) => void }) {
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
              <strong>8</strong> 次机会
            </span>
            <span>
              <strong>6</strong> 项线索
            </span>
            <span>
              <strong>30</strong> 名角色
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
        <button
          className="mode-choice"
          type="button"
          onClick={() => navigate({ name: "singleGame", mode: "daily" })}
        >
          <span className="mode-choice-top">
            <span className="mode-icon">
              <CalendarDays size={22} aria-hidden="true" />
            </span>
            <small className="mode-state live">今日可玩</small>
          </span>
          <span className="mode-title">
            <strong>每日题</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>所有玩家每天面对同一个隐藏角色。</span>
        </button>
        <button
          className="mode-choice"
          type="button"
          onClick={() => navigate({ name: "singleGame", mode: "random" })}
        >
          <span className="mode-choice-top">
            <span className="mode-icon">
              <Shuffle size={22} aria-hidden="true" />
            </span>
            <small className="mode-state">不限次数</small>
          </span>
          <span className="mode-title">
            <strong>随机题</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>从 demo 题库中随机抽取角色。</span>
        </button>
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
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await requestJson<SearchResponse>(
          `/api/characters/search?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
          },
        );
        setResults(payload.results);
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : "搜索失败。");
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <section className="page-panel">
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
      {message ? <p className="message error">{message}</p> : null}
      <div className="result-summary">
        <strong>{results.length}</strong>
        <span>条结果</span>
      </div>
      <div className="candidate-list page-candidates">
        {results.map((result) => (
          <article className="candidate static" key={result.id}>
            <span className="avatar" aria-hidden="true">
              {result.initials}
            </span>
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

function SingleGame({
  mode,
  navigate,
}: {
  mode: Exclude<GameMode, "multiplayer">;
  navigate: (route: Route) => void;
}) {
  const [session, setSession] = useState<PublicGameSession | null>(null);
  const [puzzleLabel, setPuzzleLabel] = useState(
    mode === "daily" ? "今日每日题" : "随机题",
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
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
    nextMode: Exclude<GameMode, "multiplayer">,
    nextSession: PublicGameSession,
  ) => {
    localStorage.setItem(modeConfig[nextMode].storageKey, nextSession.id);
  };

  const loadSession = async (nextMode: Exclude<GameMode, "multiplayer">) => {
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
          setPuzzleLabel(nextMode === "daily" ? "今日每日题" : "随机题");
          return;
        } catch {
          localStorage.removeItem(modeConfig[nextMode].storageKey);
        }
      }

      if (nextMode === "daily") {
        const created = await requestJson<PuzzleResponse>("/api/puzzles/daily");
        setSession(created.session);
        setPuzzleLabel(created.puzzleLabel);
        persistSession(nextMode, created.session);
      } else {
        const created = await requestJson<PuzzleResponse>(
          "/api/puzzles/random",
          { method: "POST" },
        );
        setSession(created.session);
        setPuzzleLabel(created.puzzleLabel);
        persistSession(nextMode, created.session);
      }
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

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await requestJson<SearchResponse>(
          `/api/characters/search?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
          },
        );
        setResults(payload.results);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "搜索失败。");
        }
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const submitGuess = async (characterId = selectedId) => {
    if (!session || !characterId || submitting || isFinished) return;
    setSubmitting(true);
    setMessage("");
    setShareMessage("");

    try {
      const payload = await requestJson<GuessResponse>(
        `/api/sessions/${session.id}/guess`,
        {
          method: "POST",
          body: JSON.stringify({ characterId }),
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
              <p className="kicker">
                {mode === "daily" ? "DAILY PUZZLE" : "RANDOM PUZZLE"}
              </p>
              <h1>东方角色芙一把</h1>
            </div>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="游戏模式">
            {(["daily", "random"] as const).map((modeKey) => {
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
                  width: `${((session?.guesses.length ?? 0) / (session?.maxGuesses ?? 8)) * 100}%`,
                }}
              />
            </span>
          </div>
          <div>
            <span className="label">进度</span>
            <strong>
              {session?.guesses.length ?? 0}/{session?.maxGuesses ?? 8}
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

        {message ? <p className="message error">{message}</p> : null}
        {shareMessage ? (
          <p className="message success">{shareMessage}</p>
        ) : null}

        <div className="table-wrap">
          <table className="guess-table">
            <thead>
              <tr>
                <th>角色</th>
                {GUESS_FIELDS.map((field) => (
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
                    <th scope="row">{guess.guessName}</th>
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
                  <td className="empty-state" colSpan={GUESS_FIELDS.length + 1}>
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
          <div className="answer-token">
            {session.answer?.names.zhHans.slice(0, 2)}
          </div>
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
