"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function StatsChart({
  option,
  ariaLabel,
  className = "h-[320px]",
}: {
  option: EChartsCoreOption;
  ariaLabel: string;
  className?: string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });

    const render = () => {
      const styles = getComputedStyle(document.documentElement);
      const color = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      chart.setOption(
        {
          ...option,
          backgroundColor: "transparent",
          color: [
            color("--accent", "#ad3334"),
            color("--jade", "#247568"),
            color("--amber", "#a76916"),
            color("--line-strong", "#bbc8c2"),
          ],
          textStyle: {
            color: color("--ink-soft", "#52615b"),
            fontFamily: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
          },
        },
        { notMerge: true },
      );
    };

    render();
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode", "style"],
    });
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return (
    <div
      ref={elementRef}
      className={`w-full ${className}`}
      role="img"
      aria-label={ariaLabel}
    />
  );
}

