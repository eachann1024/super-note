/**
 * showChart 工具的输出渲染卡片（echarts，懒初始化，跟随明暗主题）
 */
import { useEffect, useRef, useId } from "react";
import { useSettings } from "@/stores/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

interface ChartSeries {
  name: string;
  data: number[];
}

interface ChartCardProps {
  type: "bar" | "line" | "pie";
  title?: string;
  categories?: string[];
  series: ChartSeries[];
}

function buildOption(
  props: ChartCardProps,
  dark: boolean,
): Record<string, unknown> {
  const textColor = dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
  const axisLineColor = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  const tooltipBg = dark ? "hsl(0 0% 22%)" : "hsl(0 0% 98%)";
  const tooltipBorder = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  const tooltipText = dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)";

  const base = {
    backgroundColor: "transparent",
    textStyle: { color: textColor, fontFamily: "inherit" },
    tooltip: {
      trigger: props.type === "pie" ? "item" : "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
    },
    legend: {
      show: props.series.length > 1 || props.type === "pie",
      textStyle: { color: textColor, fontSize: 11 },
      bottom: 0,
    },
  };

  if (props.type === "pie") {
    return {
      ...base,
      title: props.title
        ? { text: props.title, textStyle: { color: textColor, fontSize: 13, fontWeight: 500 }, left: "center" }
        : undefined,
      series: [
        {
          type: "pie",
          radius: ["35%", "65%"],
          center: ["50%", "48%"],
          data: props.series[0]?.data.map((v, i) => ({
            value: v,
            name: props.categories?.[i] ?? String(i),
          })) ?? [],
          label: { color: textColor, fontSize: 11 },
          emphasis: { itemStyle: { shadowBlur: 8 } },
        },
      ],
    };
  }

  return {
    ...base,
    title: props.title
      ? { text: props.title, textStyle: { color: textColor, fontSize: 13, fontWeight: 500 } }
      : undefined,
    grid: { left: 40, right: 16, top: props.title ? 36 : 16, bottom: props.series.length > 1 ? 36 : 24 },
    xAxis: {
      type: "category",
      data: props.categories ?? [],
      axisLine: { lineStyle: { color: axisLineColor } },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: textColor, fontSize: 11 },
    },
    series: props.series.map((s) => ({
      name: s.name,
      type: props.type,
      data: s.data,
      smooth: props.type === "line",
      barMaxWidth: 32,
    })),
  };
}

export function ChartCard(props: ChartCardProps) {
  const theme = useSettings((state) => state.theme);
  const resolvedTheme = useResolvedTheme(theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const uid = useId();

  useEffect(() => {
    let chart: { setOption: (o: unknown) => void; resize: () => void; dispose: () => void } | null = null;

    const init = async () => {
      if (!containerRef.current) return;
      const echarts = await import("echarts");
      chart = echarts.init(containerRef.current, undefined, { renderer: "svg" });
      chartRef.current = chart;
      chart.setOption(buildOption(props, resolvedTheme === "dark"));
    };

    void init();

    const handleResize = () => {
      (chartRef.current as { resize?: () => void } | null)?.resize?.();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart?.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // 主题变化时重绘
  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current as { setOption: (o: unknown) => void };
    c.setOption(buildOption(props, resolvedTheme === "dark"));
  }, [props, resolvedTheme]);

  return (
    <div className="my-2 overflow-hidden rounded-[8px] border border-border">
      <div
        ref={containerRef}
        style={{ width: "100%", height: 220 }}
        aria-label={props.title ?? "图表"}
      />
    </div>
  );
}
