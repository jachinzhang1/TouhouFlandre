# 音乐播放器本地素材

本目录存放音乐播放器运行时使用的本地音频、专辑封面和封面加载失败时的占位图。它们随 Web 应用一起发布，运行时只通过 `/music/` 路径读取，不请求第三方站点。

目录结构：

```text
music/
  tracks/<album-id>/<track-id>.mp3
  covers/<album-id>.<png|jpg|webp>
  placeholder-cover.png
```

专辑、曲目、来源链接和本地 URL 的唯一数据源是 `packages/data/src/music` 中的 JSON 目录；本文件只说明目录用途和布局，不维护逐文件清单、来源或授权数据。目录级素材声明见 [`THIRD_PARTY_ASSETS.md`](../../../../THIRD_PARTY_ASSETS.md)。
