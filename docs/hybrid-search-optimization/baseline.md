# HSO-001 基线记录

记录日期：2026-08-28
提交：`e41cbd9`

## 环境

- WSL Ubuntu, WSL path: `/home/jachin/src/TouhouFriberg`
- API: `http://127.0.0.1:4000`
- Web: `http://127.0.0.1:5173`
- Node: `v24.13.0`
- CPU: 20
- 内存: 7.6 GiB
- 题库版本：`2352fabd`
- 角色数：170
- 可猜数：170
- 作品数：37
- 网络条件：本机 loopback；无外网依赖
- 写入场景：`HSO001_ALLOW_WRITES=1`，仅用于本地 disposable 数据库；每轮后都调用 `POST /api/sessions/{id}/forfeit` 清理

## 采样命令

```bash
cd /home/jachin/src/TouhouFriberg/apps/api && go test ./internal/game -count=1
cd /home/jachin/src/TouhouFriberg && pnpm --filter @touhouflandre/web exec vitest run src/fixtures/hso-001-fixtures.test.ts
cd /home/jachin/src/TouhouFriberg && HSO001_API_BASE_URL=http://127.0.0.1:4000 HSO001_ALLOW_WRITES=1 pnpm --filter @touhouflandre/web exec playwright test e2e/hso-001-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium
cd /home/jachin/src/TouhouFriberg && pnpm --filter @touhouflandre/web typecheck
```

## 结果摘要

### 资源体积

- `/api/catalog/characters`: `90900` bytes identity, `90900` bytes gzip
- `/api/catalog/full`: `146515` bytes identity, `146515` bytes gzip

### `/api/characters/search`

- hot: `requestCount=35`, `failureCount=0`, `retryCount=0`, `p50=33.56ms`, `p95=41.49ms`, `p99=46.17ms`
- cold: `requestCount=35`, `failureCount=0`, `retryCount=0`, `p50=40.12ms`, `p95=91.90ms`, `p99=294.08ms`

### 单人题局加载

- random fresh: `readyMs=5435.87`, `requestCount=8`, `cleanupStatus=200`
- random resume: `readyMs=4123.27`, `requestCount=6`, `cleanupStatus=200`
- daily fresh: `readyMs=4875.50`, `requestCount=7`, `cleanupStatus=200`
- daily resume: `readyMs=4377.64`, `requestCount=8`, `cleanupStatus=200`
- daily stale: `readyMs=2938.20`, `requestCount=9`, `cleanupStatus=200`

### 搜索建议可见时间

- desktop-chromium: `requestCount=35`, `failureCount=0`, `retryCount=0`, `p50=291.18ms`, `p95=325.55ms`, `p99=363.86ms`
- mobile-chromium: `requestCount=35`, `failureCount=0`, `retryCount=0`, `p50=326.00ms`, `p95=491.80ms`, `p99=706.14ms`

## 备注

- `search` 热/冷样本各做了 5 次 warmup，再收集 30 个有效样本。
- 搜索建议样本在单人题局页采集，避免把不存在的 `/search` 页面行为混进基线。
- 这份记录只描述当前可重复采样结果，不把一次采样写成 SLA。
