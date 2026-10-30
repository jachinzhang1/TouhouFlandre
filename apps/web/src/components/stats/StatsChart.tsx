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

const CHART_FONT = 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif';

function withOpacity(value: string, opacity: number) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!match) return value;
  const hex =
    match[1].length === 3
      ? [...match[1]].map((digit) => `${digit}${digit}`).join("")
      : match[1];
  const numeric = Number.parseInt(hex, 16);
  return `rgba(${numeric >> 16}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${opacity})`;
}

function createStatsChartTheme(styles: CSSStyleDeclaration) {
  const color = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const themeColor = color("--theme-color", "#ad3334");
  const inkColor = color("--ink", "#17231f");
  const paperColor = color("--paper", "#fbfcfb");
  const textColor = withOpacity(themeColor, 0.72);
  const strongTextColor = withOpacity(themeColor, 0.88);
  const lineColor = withOpacity(themeColor, 0.32);
  const gridColor = withOpacity(themeColor, 0.14);
  const faintColor = withOpacity(themeColor, 0.07);
  const fillColor = withOpacity(themeColor, 0.18);
  const axisCommon = () => ({
    axisLine: { lineStyle: { color: lineColor } },
    axisTick: { lineStyle: { color: lineColor } },
    minorTick: { lineStyle: { color: lineColor } },
    axisLabel: { color: textColor },
    nameTextStyle: { color: textColor },
    splitLine: { lineStyle: { color: gridColor } },
    minorSplitLine: { lineStyle: { color: faintColor } },
    splitArea: { areaStyle: { color: [faintColor, "transparent"] } },
  });

  return {
    backgroundColor: "transparent",
    color: [themeColor, themeColor, inkColor, withOpacity(themeColor, 0.34)],
    textStyle: { color: textColor, fontFamily: CHART_FONT },
    axisPointer: {
      lineStyle: { color: withOpacity(themeColor, 0.48) },
      crossStyle: { color: withOpacity(themeColor, 0.48) },
      label: { color: paperColor, backgroundColor: themeColor },
    },
    legend: { textStyle: { color: textColor } },
    tooltip: {
      backgroundColor: paperColor,
      borderColor: lineColor,
      shadowColor: fillColor,
      textStyle: { color: strongTextColor, fontFamily: CHART_FONT },
    },
    dataZoom: {
      borderColor: lineColor,
      textStyle: { color: textColor },
      brushStyle: { color: fillColor },
      fillerColor: fillColor,
      handleStyle: { color: fillColor, borderColor: textColor },
      moveHandleStyle: { color: lineColor, opacity: 1 },
      emphasis: {
        handleStyle: { color: lineColor, borderColor: strongTextColor },
        moveHandleStyle: { color: textColor, opacity: 1 },
      },
      dataBackground: {
        lineStyle: { color: lineColor },
        areaStyle: { color: faintColor },
      },
      selectedDataBackground: {
        lineStyle: { color: textColor },
        areaStyle: { color: fillColor },
      },
    },
    categoryAxis: axisCommon(),
    valueAxis: axisCommon(),
    timeAxis: axisCommon(),
    logAxis: axisCommon(),
  };
}

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

    const createChart = () => {
      const styles = getComputedStyle(document.documentElement);
      const chart = echarts.init(element, createStatsChartTheme(styles), {
        renderer: "canvas",
      });
      chart.setOption(
        { ...option, backgroundColor: "transparent" },
        { notMerge: true },
      );
      return chart;
    };

    let chart = createChart();
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);
    const themeObserver = new MutationObserver(() => {
      chart.dispose();
      chart = createChart();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode", "data-theme-color", "style"],
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
