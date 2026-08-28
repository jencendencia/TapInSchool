// Overview: daily attendance graphs + IN/OUT ratios (PRD Screen B).
import { useEffect, useId, useState } from 'react';
import type { OverviewStats } from '../../../shared/types';
import { api } from '../../lib/api';
import { Spinner } from '../../components/shared';

function StatCard({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label text-dim">{label}</div>
      <div className="stat-value" style={{ color: accent }}>{value}</div>
      {sub && <div className="stat-sub text-dim">{sub}</div>}
    </div>
  );
}

// Dependency-free SVG line chart: smooth curve, gradient area fill, animated
// draw-in, and a hover tooltip that follows the nearest point.
const CHART_W = 720;
const CHART_H = 230;
const PAD_L = 38;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 10;
const INNER_W = CHART_W - PAD_L - PAD_R;
const INNER_H = CHART_H - PAD_T - PAD_B;

function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.01} ${pts[0].y}`;
  // Quadratic curve through the midpoints — smooth without a chart library.
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

function LineChart({ data, color, label }: { data: { label: string; value: number }[]; color: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const rawMax = Math.max(1, ...data.map((d) => d.value));
  // Round the axis top up to a readable multiple of a power of ten.
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.max(rawMax, Math.ceil(rawMax / pow) * pow);
  const steps = 4;

  const x = (i: number) => PAD_L + (data.length <= 1 ? INNER_W / 2 : (i / (data.length - 1)) * INNER_W);
  const y = (v: number) => PAD_T + INNER_H - (v / niceMax) * INNER_H;

  if (data.length === 0) {
    return (
      <div className="chart-card">
        <h3 className="chart-title">{label}</h3>
        <div className="line-empty text-dim">No scans recorded yet.</div>
      </div>
    );
  }

  const pts = data.map((d, i) => ({ x: x(i), y: y(d.value) }));
  const linePath = smoothLine(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${PAD_T + INNER_H} L ${pts[0].x} ${PAD_T + INNER_H} Z`;
  const gridVals = Array.from({ length: steps + 1 }, (_, i) => (niceMax / steps) * i);
  const tooltip = hover !== null ? data[hover] : null;
  const ttY = hover !== null ? y(data[hover].value) : 0;

  return (
    <div className="chart-card">
      <h3 className="chart-title">{label}</h3>
      <div className="line-chart">
        <div className="line-svg-wrap">
        <svg className="line-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          <defs>
            <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {gridVals.map((v) => (
            <g key={v}>
              <line className="line-grid" x1={PAD_L} x2={CHART_W - PAD_R} y1={y(v)} y2={y(v)} />
              <text className="line-y" x={PAD_L - 8} y={y(v) + 3.5} textAnchor="end">
                {Math.round(v)}
              </text>
            </g>
          ))}
          <path className="line-area" d={areaPath} fill={`url(#grad-${gid})`} />
          <path className="line-path" d={linePath} fill="none" stroke={color} strokeWidth={2.5} pathLength={1} />
          {pts.map((p, i) => (
            <g key={i}>
              <circle
                className={`line-dot${hover === i ? ' on' : ''}`}
                cx={p.x}
                cy={p.y}
                r={hover === i ? 6 : 4}
                fill={color}
                color={color}
              />
              <rect
                className="line-hit"
                x={p.x - 18}
                y={PAD_T}
                width={36}
                height={INNER_H}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
        {tooltip && hover !== null && (
          <div
            className={`line-tooltip${ttY < 46 ? ' below' : ''}`}
            style={{
              left: `${(x(hover) / CHART_W) * 100}%`,
              top: `${(ttY / CHART_H) * 100}%`,
            }}
          >
            <span className="line-tooltip-label">{tooltip.label}</span>
            <span className="line-tooltip-value" style={{ color }}>{tooltip.value} scans</span>
          </div>
        )}
        </div>
        <div
          className="line-xlabels"
          style={{
            paddingLeft: `${(PAD_L / CHART_W) * 100}%`,
            paddingRight: `${(PAD_R / CHART_W) * 100}%`,
            justifyContent: data.length === 1 ? 'center' : 'space-between',
          }}
        >
          {data.map((d, i) => (
            <span key={i} className={hover === i ? 'on' : ''}>{d.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ChartSeries {
  name: string;
  color: string;
  points: { label: string; value: number }[];
}

// Multi-line variant of LineChart: several series share one x-axis (used for
// the IN vs OUT hourly chart). Hovering a column shows every series' value.
// NOTE: all series must carry the same labels, aligned by index — points[i]
// is plotted against series[0].points[i].label.
function MultiLineChart({ series, label }: { series: ChartSeries[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const rawMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.max(rawMax, Math.ceil(rawMax / pow) * pow);
  const steps = 4;

  const x = (i: number) => PAD_L + (labels.length <= 1 ? INNER_W / 2 : (i / (labels.length - 1)) * INNER_W);
  const y = (v: number) => PAD_T + INNER_H - (v / niceMax) * INNER_H;

  if (labels.length === 0) {
    return (
      <div className="chart-card">
        <h3 className="chart-title">{label}</h3>
        <div className="line-empty text-dim">No scans recorded yet.</div>
      </div>
    );
  }

  const gridVals = Array.from({ length: steps + 1 }, (_, i) => (niceMax / steps) * i);
  const tooltip = hover !== null ? labels[hover] : null;
  const ttY = hover !== null ? Math.min(...series.map((s) => y(s.points[hover]?.value ?? 0))) : 0;

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <h3 className="chart-title">{label}</h3>
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name} <b>{s.points.reduce((sum, p) => sum + p.value, 0)}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="line-chart">
        <div className="line-svg-wrap">
          <svg className="line-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
            <defs>
              {series.map((s, si) => (
                <linearGradient key={s.name} id={`grad-${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
                </linearGradient>
              ))}
            </defs>
            {gridVals.map((v) => (
              <g key={v}>
                <line className="line-grid" x1={PAD_L} x2={CHART_W - PAD_R} y1={y(v)} y2={y(v)} />
                <text className="line-y" x={PAD_L - 8} y={y(v) + 3.5} textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            {series.map((s, si) => {
              const pts = s.points.map((p, i) => ({ x: x(i), y: y(p.value) }));
              const linePath = smoothLine(pts);
              const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${PAD_T + INNER_H} L ${pts[0].x} ${PAD_T + INNER_H} Z`;
              return (
                <g key={s.name}>
                  <path className="line-area" d={areaPath} fill={`url(#grad-${gid}-${si})`} />
                  <path className="line-path" d={linePath} fill="none" stroke={s.color} strokeWidth={2.2} pathLength={1} />
                  {pts.map((p, i) => (
                    <circle
                      key={i}
                      className={`line-dot${hover === i ? ' on' : ''}`}
                      cx={p.x}
                      cy={p.y}
                      r={hover === i ? 5 : 3}
                      fill={s.color}
                      color={s.color}
                    />
                  ))}
                </g>
              );
            })}
            {labels.map((_, i) => (
              <rect
                key={i}
                className="line-hit"
                x={x(i) - 18}
                y={PAD_T}
                width={36}
                height={INNER_H}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>
          {tooltip && hover !== null && (
            <div
              className={`line-tooltip${ttY < 46 ? ' below' : ''}`}
              style={{
                left: `${(x(hover) / CHART_W) * 100}%`,
                top: `${(ttY / CHART_H) * 100}%`,
              }}
            >
              <span className="line-tooltip-label">{tooltip}</span>
              {series.map((s) => (
                <span className="line-tooltip-row" key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name} <b style={{ color: s.color }}>{s.points[hover]?.value ?? 0}</b>
                </span>
              ))}
            </div>
          )}
        </div>
        <div
          className="line-xlabels"
          style={{
            paddingLeft: `${(PAD_L / CHART_W) * 100}%`,
            paddingRight: `${(PAD_R / CHART_W) * 100}%`,
            justifyContent: labels.length === 1 ? 'center' : 'space-between',
          }}
        >
          {labels.map((d, i) => (
            <span key={i} className={hover === i ? 'on' : ''}>{d}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Donut({ inCount, outCount }: { inCount: number; outCount: number }) {
  const total = inCount + outCount || 1;
  const inPct = (inCount / total) * 100;
  const r = 54;
  const circ = 2 * Math.PI * r;
  return (
    <div className="chart-card donut-card">
      <h3 className="chart-title">Today IN / OUT</h3>
      <div className="donut-wrap">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r={r} fill="none" stroke="#1E293B" strokeWidth="16" />
          <circle
            cx="75"
            cy="75"
            r={r}
            fill="none"
            stroke="#10B981"
            strokeWidth="16"
            strokeDasharray={`${(inPct / 100) * circ} ${circ}`}
            strokeDashoffset={circ * 0.25}
            strokeLinecap="round"
            transform="rotate(-90 75 75)"
          />
        </svg>
        <div className="donut-center">
          <span className="donut-value">{inCount + outCount}</span>
          <span className="text-dim">scans</span>
        </div>
      </div>
      <div className="legend">
        <span><i className="lg-dot in" /> IN {inCount}</span>
        <span><i className="lg-dot out" /> OUT {outCount}</span>
      </div>
    </div>
  );
}

function SmsQueueMonitor({ stats }: { stats: OverviewStats }) {
  const { smsSentToday, smsPendingToday, smsFailedToday } = stats;
  const total = smsSentToday + smsPendingToday + smsFailedToday;
  const pct = total > 0 ? Math.round((smsSentToday / total) * 100) : 0;
  const hasPending = smsPendingToday > 0;

  return (
    <div className="sms-queue-monitor">
      <div className="sms-queue-head">
        <h3>SMS Queue</h3>
        {hasPending && <span className="live-badge"><span className="live-dot" /> LIVE</span>}
      </div>
      {total > 0 ? (
        <>
          <div className="sms-queue-bar-wrap">
            <div className="sms-queue-bar">
              <div className="sms-queue-bar-fill" style={{ width: `${pct}%` }} />
              <div className="sms-queue-bar-failed" style={{ width: `${(smsFailedToday / total) * 100}%` }} />
            </div>
            <span className="sms-queue-pct">{pct}%</span>
          </div>
          <div className="sms-queue-counts">
            <span className="sms-qc sms-qc-sent">✓ {smsSentToday} sent</span>
            {hasPending && <span className="sms-qc sms-qc-pending">⏳ {smsPendingToday} queued</span>}
            {smsFailedToday > 0 && <span className="sms-qc sms-qc-failed">✕ {smsFailedToday} failed</span>}
          </div>
          {hasPending && (
            <p className="sms-queue-eta text-dim">
              Est. ~{Math.ceil(smsPendingToday / 0.8)}s remaining (2 modems)
            </p>
          )}
        </>
      ) : (
        <p className="text-dim" style={{ padding: '8px 0' }}>No SMS activity today</p>
      )}
    </div>
  );
}

export function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);

  // Auto-refresh: poll every 3s while there are pending SMS, otherwise 30s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      void api.getOverview().then((s) => {
        setStats(s);
        timer = setTimeout(poll, s.smsPendingToday > 0 ? 3_000 : 30_000);
      });
    };
    poll();
    return () => clearTimeout(timer);
  }, []);

  if (!stats) return <Spinner label="Loading overview…" />;

  const activeHours = stats.hourlyToday.filter((h) => h.in + h.out > 0);
  const labelOf = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const hourlySeries: ChartSeries[] = [
    { name: 'IN', color: '#10B981', points: activeHours.map((h) => ({ label: labelOf(h.hour), value: h.in })) },
    { name: 'OUT', color: '#6366F1', points: activeHours.map((h) => ({ label: labelOf(h.hour), value: h.out })) },
  ];
  const week = stats.last7Days.map((d) => ({
    label: d.date.slice(5),
    value: d.total,
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h2>Overview</h2>
        <p className="text-dim">Live attendance summary for today</p>
      </div>

      <div className="stat-grid">
        <StatCard label="Scans today" value={stats.todayTotal} accent="#E2E8F0" />
        <StatCard label="Checked IN" value={stats.todayIn} accent="#10B981" />
        <StatCard label="Checked OUT" value={stats.todayOut} accent="#6366F1" />
        <StatCard label="SMS sent" value={stats.smsSentToday} accent="#34D399" />
        <StatCard label="SMS queued" value={stats.smsPendingToday} accent="#F59E0B" />
        <StatCard label="SMS failed" value={stats.smsFailedToday} accent="#F43F5E" />
        <StatCard label="Late arrivals" value={stats.lateToday} accent="#F59E0B" sub="IN after bell + grace" />
        <StatCard label="Early departures" value={stats.earlyToday} accent="#38BDF8" sub="OUT before dismissal" />
        <StatCard label="Not scanned today" value={stats.absentToday} accent="#F43F5E" sub={`of ${stats.activeStudents} active`} />
        <StatCard label="Active students" value={stats.activeStudents} accent="#E2E8F0" sub={`of ${stats.totalStudents} enrolled`} />
      </div>

      <SmsQueueMonitor stats={stats} />

      <div className="chart-grid">
        <MultiLineChart series={hourlySeries} label="Scans by hour (today)" />
        <Donut inCount={stats.todayIn} outCount={stats.todayOut} />
      </div>
      <LineChart data={week} color="#6366F1" label="Scans — last 7 days" />
    </div>
  );
}
