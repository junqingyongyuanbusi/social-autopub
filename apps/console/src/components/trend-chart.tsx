"use client";

import { AnalyticsMetricPoint } from "@/lib/api";

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 26, left: 56 };

const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// 无依赖 SVG 折线图：绘制单指标按日快照趋势（数值轴自适应，两端标注首末日期）
export function TrendChart({ points }: { points: AnalyticsMetricPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        该窗口内暂无数据点
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const span = maxValue - minValue || 1;
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number) =>
    points.length === 1
      ? PADDING.left + innerWidth / 2
      : PADDING.left + (index / (points.length - 1)) * innerWidth;
  const y = (value: number) =>
    PADDING.top + (1 - (value - minValue) / span) * innerHeight;

  const linePoints = points
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(" ");
  const areaPath = [
    `M ${x(0)},${HEIGHT - PADDING.bottom}`,
    ...points.map(
      (point, index) => `L ${x(index)},${y(point.value)}`,
    ),
    `L ${x(points.length - 1)},${HEIGHT - PADDING.bottom}`,
    "Z",
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-48 w-full"
      role="img"
      aria-label="指标趋势折线图"
    >
      <path d={areaPath} className="fill-primary/10" />
      <polyline
        points={linePoints}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point, index) => (
        <circle
          key={point.date}
          cx={x(index)}
          cy={y(point.value)}
          r="2.5"
          className="fill-primary"
        >
          <title>{`${point.date}：${point.value.toLocaleString("zh-CN")}`}</title>
        </circle>
      ))}
      <text
        x={PADDING.left - 8}
        y={y(maxValue) + 4}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {compactNumber.format(maxValue)}
      </text>
      <text
        x={PADDING.left - 8}
        y={y(minValue) + 4}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {compactNumber.format(minValue)}
      </text>
      <text
        x={PADDING.left}
        y={HEIGHT - 8}
        className="fill-muted-foreground text-[10px]"
      >
        {points[0].date}
      </text>
      <text
        x={WIDTH - PADDING.right}
        y={HEIGHT - 8}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {points[points.length - 1].date}
      </text>
    </svg>
  );
}
