import { useEffect, useRef, useState } from "react";
import { ema, type Candle } from "@/lib/indicators";

interface Props {
  candles: Candle[];
  height?: number;
}

export function CandleChart({ candles, height = 420 }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(320, Math.floor(e.contentRect.width)));
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  if (candles.length === 0) {
    return <div className="text-sm text-muted-foreground">No candle data yet.</div>;
  }

  const padding = { l: 56, r: 12, t: 12, b: 80 };
  const volH = 60;
  const priceH = height - padding.t - padding.b - volH - 8;
  const plotW = width - padding.l - padding.r;

  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);

  const maxP = Math.max(...candles.map((c) => c.high));
  const minP = Math.min(...candles.map((c) => c.low));
  const pSpan = maxP - minP || 1;
  const maxV = Math.max(...candles.map((c) => c.volume)) || 1;

  const n = candles.length;
  const cw = plotW / n;
  const bodyW = Math.max(1, cw * 0.7);

  const px = (i: number) => padding.l + i * cw + cw / 2;
  const py = (p: number) => padding.t + (1 - (p - minP) / pSpan) * priceH;
  const vy = (v: number) => padding.t + priceH + 8 + (1 - v / maxV) * volH;

  const gridLines = 5;
  const gridY = Array.from({ length: gridLines }, (_, i) => {
    const p = minP + (pSpan * i) / (gridLines - 1);
    return { p, y: py(p) };
  });

  const path = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`)
      .join(" ");

  const xLabels: { x: number; label: string }[] = [];
  const step = Math.max(1, Math.floor(n / 8));
  for (let i = 0; i < n; i += step) {
    const d = new Date(candles[i].candle_ts);
    xLabels.push({
      x: px(i),
      label: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  }

  return (
    <div ref={wrapperRef} className="w-full">
      <svg width={width} height={height} className="block">
        {/* grid */}
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padding.l} x2={padding.l + plotW} y1={g.y} y2={g.y} stroke="var(--grid)" strokeDasharray="2 4" />
            <text x={padding.l - 6} y={g.y + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" className="font-mono">
              {g.p.toFixed(1)}
            </text>
          </g>
        ))}

        {/* candles */}
        {candles.map((c, i) => {
          const bull = c.close >= c.open;
          const color = bull ? "var(--bull)" : "var(--bear)";
          const yo = py(c.open);
          const yc = py(c.close);
          const yh = py(c.high);
          const yl = py(c.low);
          const x = px(i);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={yh} y2={yl} stroke={color} strokeWidth={1} />
              <rect
                x={x - bodyW / 2}
                y={Math.min(yo, yc)}
                width={bodyW}
                height={Math.max(1, Math.abs(yc - yo))}
                fill={color}
                opacity={0.9}
              />
            </g>
          );
        })}

        {/* EMAs */}
        <path d={path(e9)} stroke="var(--ema-9)" strokeWidth={1.25} fill="none" />
        <path d={path(e21)} stroke="var(--ema-21)" strokeWidth={1.25} fill="none" />
        <path d={path(e50)} stroke="var(--ema-50)" strokeWidth={1.25} fill="none" />

        {/* volume */}
        {candles.map((c, i) => {
          const bull = c.close >= c.open;
          const y = vy(c.volume);
          const h = padding.t + priceH + 8 + volH - y;
          return (
            <rect
              key={`v${i}`}
              x={px(i) - bodyW / 2}
              y={y}
              width={bodyW}
              height={Math.max(1, h)}
              fill={bull ? "var(--bull)" : "var(--bear)"}
              opacity={0.35}
            />
          );
        })}

        {/* x labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)" className="font-mono">
            {l.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs font-mono mt-2">
        <Legend color="var(--ema-9)" label="EMA 9" />
        <Legend color="var(--ema-21)" label="EMA 21" />
        <Legend color="var(--ema-50)" label="EMA 50" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-0.5" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
