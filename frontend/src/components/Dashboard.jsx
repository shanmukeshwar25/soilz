import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Brush
} from 'recharts';
import {
  Leaf, Box, ArrowUpRight, ArrowDownRight,
  Activity, PieChart as PieChartIcon,
  BarChart3, LineChart as LineChartIcon, LayoutDashboard, TrendingUp, X, Calendar, SlidersHorizontal, Moon, Sun
} from 'lucide-react';
import { getFilters, getTimeSeriesData, getSummaryStats, getDateRange } from '../services/api';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#14b8a6',
  '#f43f5e', '#d946ef', '#0ea5e9', '#eab308', '#2dd4bf', '#fb923c'
];


// ── Dutch → English measure name translations ─────────────────────────────────
const MEASURE_LABELS = {
  'Opbrengst vers': 'Fresh Yield',
  'Opbrengst droge stof': 'Dry Matter Yield',
  'Aluminium': 'Al',
  'N-leverend vermogen': 'N-Rated Power',
  'Totaal-Stikstof': 'Total Nitrogen',
  'Fosfaat': 'P₂O₅',
  'Chloride': 'Cl',
  'Nitraatstikstof': 'Nitrate Nitrogen',
  'Ammoniumstikstof': 'Ammonium Nitrogen',
  'Seleen': 'Selenium',
};
/** Returns "Dutch (English)" if a translation exists, otherwise just the raw name. */
function measureLabel(name) {
  const en = MEASURE_LABELS[name];
  return en ? `${name} (${en})` : name;
}


// ── helpers ──────────────────────────────────────────────────────────────────
function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function ymd(date) {
  return date.toISOString().slice(0, 10);
}
function fmtWindow(s, e) {
  return `${s.toLocaleString('default', { month: 'short' })} ${s.getFullYear()} – ${e.toLocaleString('default', { month: 'short' })} ${e.getFullYear()}`;
}
// date field from backend: "2024-04-08 14:05:00 (Batch 13853)"
function parseDatePart(tick) {
  if (!tick) return '';
  if (typeof tick === 'number') return '';
  const s = String(tick);
  // extract just the date portion YYYY-MM-DD
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) return s.split(' ')[0];
  return m[1];
}
function formatDateTick(tick) {
  const dateStr = parseDatePart(tick);
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  } catch { return dateStr; }
}
function formatTooltipLabel(tick) {
  if (!tick || typeof tick === 'number') return '';
  const s = String(tick);
  const datePart = parseDatePart(s);
  const batchMatch = s.match(/\(Batch ([^)]+)\)/);
  const batch = batchMatch ? `  ·  Batch ${batchMatch[1]}` : '';
  try {
    const d = new Date(datePart);
    const timePart = s.split(' ')[1] || '';
    const formatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `Sampled: ${formatted} ${timePart}${batch}`;
  } catch { return s; }
}

// ── main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [filters, setFilters] = useState({ crops: [], soil_types: [] });
  const [selectedCrop, setSelectedCrop] = useState('');
  const [selectedSoil, setSelectedSoil] = useState('');
  const [plotType, setPlotType] = useState('line');
  const [activeTab, setActiveTab] = useState('summary');
  const [selectedWindow, setSelectedWindow] = useState('All');

  const [chartData, setChartData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [cropDateRange, setCropDateRange] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedMeasures, setSelectedMeasures] = useState(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const [selectedCompositionDate, setSelectedCompositionDate] = useState('');
  const [selectedCompositionBatch, setSelectedCompositionBatch] = useState('All');
  const [batchSearch, setBatchSearch] = useState('');
  const [pieViewMode, setPieViewMode] = useState('latest'); // 'latest' | 'mean'



  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // ── initial filter load ──
  useEffect(() => {
    getFilters().then(data => {
      setFilters(data);
      if (data.crops.length) setSelectedCrop(data.crops[0]);
      if (data.soil_types.length) setSelectedSoil(data.soil_types[0]);
    }).catch(console.error);
  }, []);

  // ── load data on crop/soil change ──
  useEffect(() => {
    if (!selectedCrop || !selectedSoil) return;
    setLoading(true);

    Promise.all([
      getTimeSeriesData(selectedCrop, selectedSoil),
      getSummaryStats(selectedCrop, selectedSoil),
      getDateRange(selectedCrop, selectedSoil),
    ]).then(([tData, sData, dateRange]) => {
      const meaningful = sData
        .filter(s => s.max > 0)
        .sort((a, b) => b.latest - a.latest);

      setChartData(tData);
      setSummaryData(meaningful);
      setCropDateRange(dateRange);
      setSelectedWindow('All');

      setSelectedMeasures(new Set(meaningful.slice(0, 6).map(s => s.measure)));
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedCrop, selectedSoil]);

  // ── precise windows derived from actual sample CreatedDates per crop cycle ──
  const availableWindows = useMemo(() => {
    if (!cropDateRange || !Array.isArray(cropDateRange) || cropDateRange.length === 0) return [];

    // Backend already: grouped by CropStart+CropEnd, deduped labels, sorted by first_sample
    // Each entry: { label, first_sample, last_sample }
    const seen = new Set();
    const out = [];
    cropDateRange.forEach(w => {
      const lbl = w.label;
      if (seen.has(lbl)) return;   // belt-and-suspenders dedup on the client too
      seen.add(lbl);
      out.push({
        label: lbl,
        value: lbl,   // use label as the select value (unique after dedup)
        firstSample: new Date(w.first_sample),
        lastSample: new Date(w.last_sample),
      });
    });
    // Sort chronologically by firstSample
    out.sort((a, b) => a.firstSample - b.firstSample);
    return out;
  }, [cropDateRange]);

  // ── filtered chart data — compare CreatedDate against first/last sample bounds ──
  const filteredChartData = useMemo(() => {
    if (selectedWindow === 'All') return chartData;
    const win = availableWindows.find(w => w.value === selectedWindow);
    if (!win) return chartData;
    return chartData.filter(d => {
      // d.date = "2024-04-08 14:05:00 (Batch 13853)"
      const m = String(d.date).match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})|(\d{4}-\d{2}-\d{2})/);
      if (!m) return true;
      const dtVal = new Date(m[0]);   // full datetime if present, else date-only
      return dtVal >= win.firstSample && dtVal <= win.lastSample;
    });
  }, [chartData, selectedWindow, availableWindows]);

  // ── sidebar helpers ──
  const sortedSummaryData = useMemo(() =>
    [...summaryData].sort((a, b) => b.latest - a.latest).filter(s => s.max > 0),
    [summaryData]
  );

  const toggleMeasure = m => {
    const next = new Set(selectedMeasures);
    next.has(m) ? next.delete(m) : next.add(m);
    setSelectedMeasures(next);
  };

  const toggleAll = () => {
    setSelectedMeasures(
      selectedMeasures.size === sortedSummaryData.length
        ? new Set()
        : new Set(sortedSummaryData.map(s => s.measure))
    );
  };

  const visibleSummaryData = useMemo(() =>
    sortedSummaryData.filter(s => selectedMeasures.has(s.measure)),
    [sortedSummaryData, selectedMeasures]
  );

  // group by unit for separate charts
  const measuresByUnit = useMemo(() => {
    const g = {};
    visibleSummaryData.forEach((stat, i) => {
      const u = stat.unit;
      if (!g[u]) g[u] = [];
      g[u].push({ ...stat, color: COLORS[i % COLORS.length] });
    });
    return g;
  }, [visibleSummaryData]);

  const piePerUnit = useMemo(() => {
    const g = {};
    visibleSummaryData.filter(s => s.latest > 0).forEach((s, i) => {
      const u = s.unit;
      if (!g[u]) g[u] = [];
      g[u].push({ name: s.measure, value: s.latest, fill: COLORS[i % COLORS.length] });
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => b.value - a.value));
    return g;
  }, [visibleSummaryData]);

  // Mean pie: uses average values instead of latest
  const meanPiePerUnit = useMemo(() => {
    const g = {};
    visibleSummaryData.filter(s => s.average > 0).forEach((s, i) => {
      const u = s.unit;
      if (!g[u]) g[u] = [];
      g[u].push({ name: s.measure, value: s.average, fill: COLORS[i % COLORS.length] });
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => b.value - a.value));
    return g;
  }, [visibleSummaryData]);

  function CustomTooltip({ active, payload, label, unit }) {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const dateStr = formatTooltipLabel(label);

      return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 rounded-2xl shadow-[0_20px_40px_-8px_rgba(0,0,0,0.14)] p-5 min-w-[280px]">
          <div className="border-b border-slate-100 pb-3 mb-3">
            <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-[13px]">{dateStr}</h4>
            {data.Crop && data.SoilType && (
              <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 mt-1.5 uppercase tracking-wider">
                {data.Crop} · {data.SoilType}
              </p>
            )}
            {data.CropStartDate && data.CropEndDate && (
              <div className="mt-1 flex items-center gap-1.5 font-bold text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                <span className="bg-slate-100 text-slate-600 dark:text-slate-400 dark:text-slate-500 px-2 py-0.5 rounded-md">Planted: {data.CropStartDate}</span>
                <span className="text-slate-300">→</span>
                <span className="bg-slate-100 text-slate-600 dark:text-slate-400 dark:text-slate-500 px-2 py-0.5 rounded-md">End: {data.CropEndDate}</span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {payload.map((entry, index) => {
              const val = entry.value !== null && entry.value !== undefined ? Number(entry.value).toFixed(2) : '—';
              return (
                <div key={index} className="flex items-center justify-between gap-6 text-[13px]">
                  <div className="flex items-center gap-2 font-bold" style={{ color: entry.color }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></span>
                    {entry.name}
                  </div>
                  <div className="font-black text-slate-700 dark:text-slate-300">
                    {val} <span className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold">{unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  }

  // ── scrollable chart renderer ──────────────────────────────────────────────
  const renderPlot = (unit, measures) => {
    const data = filteredChartData;

    let ChartComponent = LineChart;
    if (plotType === 'bar') ChartComponent = BarChart;
    if (plotType === 'area') ChartComponent = AreaChart;

    const gridColor = isDark ? '#334155' : '#E2E8F0';
    const axisColor = isDark ? '#94a3b8' : '#475569';
    const axisLineColor = isDark ? '#475569' : '#cbd5e1';

    const chartMargin = { top: 20, right: 20, left: 20, bottom: 20 };

    const tooltipEl = (
      <Tooltip
        cursor={{ strokeDasharray: '4 4', strokeWidth: 1.5, stroke: axisLineColor }}
        content={<CustomTooltip unit={unit} />}
      />
    );

    const renderSeries = () => measures.map(m => {
      if (plotType === 'bar')
        return <Bar key={m.measure} dataKey={m.measure} fill={m.color} yAxisId="left"
          radius={[5, 5, 0, 0]} maxBarSize={40} isAnimationActive={false} />;
      if (plotType === 'area')
        return <Area key={m.measure} type="monotone" dataKey={m.measure} yAxisId="left"
          stroke={m.color} fill={m.color} fillOpacity={0.12}
          strokeWidth={2.5} connectNulls isAnimationActive={false}
          dot={{ r: 4, fill: m.color, stroke: '#fff', strokeWidth: 2 }}
          activeDot={{ r: 7, fill: m.color, stroke: '#fff', strokeWidth: 2 }} />;
      return <Line key={m.measure} type="monotone" dataKey={m.measure} yAxisId="left"
        stroke={m.color} strokeWidth={2.5} connectNulls isAnimationActive={false}
        dot={{ r: 4, fill: m.color, stroke: '#fff', strokeWidth: 2 }}
        activeDot={{ r: 7, fill: m.color, stroke: '#fff', strokeWidth: 2 }} />;
    });

    // ── axis tick formatter ────────────────────────────────────────────────
    const fmtTick = v => { const n = Number(v); return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`; };

    return (
      <div key={unit} className="mb-12 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-shadow overflow-hidden">
        <div className="px-8 pt-7 pb-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-500" />
              {unit} — Nutrient Trajectory
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500 mt-1">
              {measures.length} parameter(s) · {data.length} sample points
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {measures.map(m => (
              <span key={m.measure} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border"
                style={{ color: m.color, borderColor: m.color + '55', backgroundColor: m.color + '12' }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: m.color }} />
                {measureLabel(m.measure)}
              </span>
            ))}
          </div>
        </div>

        {data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 dark:text-slate-500 font-bold bg-slate-50 dark:bg-slate-950 m-6 rounded-2xl border-2 border-dashed border-slate-200">
            No data for this window.
          </div>
        ) : (
          <div className="w-full h-[550px] p-4 pr-10">
            <ResponsiveContainer width="100%" height="100%">
              <ChartComponent data={data} margin={chartMargin}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={gridColor} />

                <XAxis
                  dataKey="date"
                  tickFormatter={tick => {
                    const d = parseDatePart(tick);
                    if (!d) return '';
                    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
                    catch { return d; }
                  }}
                  tick={{ fontSize: 12, fill: axisColor, fontWeight: 700 }}
                  tickMargin={14}
                  axisLine={{ stroke: axisLineColor, strokeWidth: 1.5 }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  angle={-35}
                  textAnchor="end"
                  height={60}
                />

                {/* ── Y-axis ── */}
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={{ fontSize: 12, fill: axisColor, fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                  domain={['auto', 'auto']}
                  tickFormatter={fmtTick}
                  label={{
                    value: unit,
                    angle: -90,
                    position: 'insideLeft',
                    offset: 10,
                    style: { fontSize: 11, fill: axisColor, fontWeight: 700 }
                  }}
                />

                {tooltipEl}

                <Legend
                  wrapperStyle={{ paddingTop: 0, paddingBottom: 15 }}
                  iconType="circle"
                  iconSize={10}
                  verticalAlign="top"
                  formatter={(v, entry) => {
                    return (
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>
                        {measureLabel(v)}
                      </span>
                    );
                  }}
                />

                {renderSeries()}
              </ChartComponent>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };


  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans relative overflow-x-hidden">

      {/* ── Parameter Sidebar ── */}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-[340px] bg-white dark:bg-slate-900 z-50 shadow-2xl
        transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-indigo-500" /> Parameters
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                Sorted by latest value ↓
              </p>
            </div>
            <button onClick={() => setIsSidebarOpen(false)}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-500 dark:text-slate-400 dark:text-slate-500 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-3 flex-shrink-0">
            <button onClick={toggleAll}
              className="w-full font-bold bg-indigo-50 text-indigo-700 py-3 rounded-xl hover:bg-indigo-100 transition-colors text-sm uppercase tracking-widest">
              {selectedMeasures.size === sortedSummaryData.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-1.5">
            {sortedSummaryData.map((stat, idx) => {
              const checked = selectedMeasures.has(stat.measure);
              return (
                <label key={stat.measure}
                  className={`flex items-start gap-3 p-3.5 rounded-2xl cursor-pointer transition-all border-2
                    ${checked ? 'bg-indigo-50/50 border-indigo-200' : 'border-transparent hover:bg-slate-50 dark:bg-slate-950'}`}>
                  <input type="checkbox" checked={checked}
                    className="mt-1 w-5 h-5 rounded-md text-indigo-600 border-slate-300 cursor-pointer"
                    onChange={() => toggleMeasure(stat.measure)} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${checked ? 'font-black text-indigo-900' : 'font-semibold text-slate-600 dark:text-slate-400 dark:text-slate-500'}`}>
                      {measureLabel(stat.measure)}
                    </p>
                    <div className="mt-1 flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase">#{idx + 1}</span>
                      <span className="text-[11px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">
                        {stat.latest.toFixed(1)} {stat.unit}
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
            {sortedSummaryData.length === 0 && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10 uppercase tracking-widest font-bold">No variables.</p>
            )}
          </div>
        </div>
      </div>

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40"
          onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ── Main Content ── */}
      <div className="p-4 md:p-8 max-w-[1920px] mx-auto pb-24">

        {/* Header */}
        <header className="mb-8 flex flex-col xl:flex-row justify-between items-center bg-white dark:bg-slate-900 p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 gap-6">
          <div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-4">
              <Leaf className="w-10 h-10 text-emerald-500 shrink-0" />
              Soil Analytics
            </h1>
            <p className="text-slate-500 dark:text-slate-400 dark:text-slate-500 mt-3 text-base font-semibold max-w-xl leading-relaxed">
              Historical soil nutrient tracking across crops and soil types.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap justify-end items-end gap-5">
            {/* Dark Mode Toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className="h-[46px] w-[46px] flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
            >
              {isDark ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-indigo-500" />}
            </button>

            {/* Chart type */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 flex items-center gap-1">
                <LineChartIcon className="w-3.5 h-3.5" /> Chart Type
              </label>
              <div className="relative">
                <select value={plotType} onChange={e => setPlotType(e.target.value)}
                  className="appearance-none bg-slate-50 dark:bg-slate-950 border-2 border-slate-100 text-slate-700 dark:text-slate-300 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  <option value="line">Line</option>
                  <option value="bar">Bar</option>
                  <option value="area">Area</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500" />
              </div>
            </div>



            {/* Timeline focus */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Timeline Focus
              </label>
              <div className="relative">
                <select value={selectedWindow} onChange={e => setSelectedWindow(e.target.value)}
                  className="appearance-none bg-slate-50 dark:bg-slate-950 border-2 border-slate-100 text-slate-700 dark:text-slate-300 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-black hover:border-slate-300 cursor-pointer text-sm min-w-[190px]">
                  <option value="All">Complete History</option>
                  {availableWindows.map(w => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500" />
              </div>
            </div>

            {/* Crop */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Crop</label>
              <div className="relative">
                <select value={selectedCrop} onChange={e => setSelectedCrop(e.target.value)}
                  className="appearance-none bg-slate-50 dark:bg-slate-950 border-2 border-slate-100 text-slate-700 dark:text-slate-300 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  {filters.crops.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
              </div>
            </div>

            {/* Soil */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Soil Type</label>
              <div className="relative">
                <select value={selectedSoil} onChange={e => setSelectedSoil(e.target.value)}
                  className="appearance-none bg-slate-50 dark:bg-slate-950 border-2 border-slate-100 text-slate-700 dark:text-slate-300 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  {filters.soil_types.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500" />
              </div>
            </div>
          </div>
        </header>

        {/* Sticky Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-2xl shadow-sm border border-slate-200 mb-8 sticky top-4 z-30 gap-3">
          <div className="flex gap-2 overflow-x-auto p-1">
            {[
              { key: 'summary', label: 'Insight Cards', icon: <LayoutDashboard className="w-4 h-4" /> },
              { key: 'trends', label: 'Trajectory Plots', icon: <TrendingUp className="w-4 h-4" /> },
              { key: 'composition', label: 'Composition Split', icon: <PieChartIcon className="w-4 h-4" /> },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[14px] transition-all whitespace-nowrap
                  ${activeTab === tab.key ? 'bg-slate-900 text-white shadow' : 'text-slate-500 dark:text-slate-400 dark:text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-200'}`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <button onClick={() => setIsSidebarOpen(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-50 border-2 border-indigo-100
              hover:bg-indigo-600 hover:border-indigo-600 hover:text-white text-indigo-700 font-black text-sm
              transition-all focus:outline-none">
            <SlidersHorizontal className="w-4 h-4" />
            Parameters ({selectedMeasures.size})
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-48 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100">
            <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
            <p className="mt-6 text-slate-400 dark:text-slate-500 font-bold tracking-widest uppercase text-sm">Loading data…</p>
          </div>
        ) : summaryData.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 p-24 rounded-3xl text-center border border-slate-100 flex flex-col items-center">
            <Box className="w-20 h-20 text-slate-200 mb-6" />
            <h3 className="text-2xl font-black text-slate-700 dark:text-slate-300">No data found</h3>
            <p className="text-slate-400 dark:text-slate-500 mt-3 max-w-md">No measurements recorded for this crop / soil combination.</p>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── PAGE: Summary Cards ── */}
            {activeTab === 'summary' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                {visibleSummaryData.map(stat => {
                  const up = stat.latest >= stat.average;
                  return (
                    <div key={stat.measure}
                      className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                      <div className="flex justify-between items-start gap-2 mb-4">
                        <h3 className="text-sm font-black text-slate-700 dark:text-slate-300 line-clamp-3 leading-snug" title={measureLabel(stat.measure)}>
                          {measureLabel(stat.measure)}
                        </h3>
                        <div className={`p-2 rounded-xl shrink-0 ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {up ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        </div>
                      </div>
                      <div className="flex items-end gap-1.5">
                        <span className="text-4xl font-black text-slate-900 dark:text-slate-100 tracking-tighter leading-none">
                          {stat.latest.toFixed(1)}
                        </span>
                      </div>
                      <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1.5 block pb-4 border-b border-slate-100">
                        {stat.unit}
                      </span>
                      <div className="mt-4 flex justify-between text-xs font-bold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                        <div>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase block mb-0.5">Mean</span>
                          <span className="text-slate-800 dark:text-slate-200 text-base">{stat.average.toFixed(1)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase block mb-0.5">Peak</span>
                          <span className="text-slate-800 dark:text-slate-200 text-base">{stat.max.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {visibleSummaryData.length === 0 && (
                  <div className="col-span-full bg-white dark:bg-slate-900 p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center">
                    <SlidersHorizontal className="w-10 h-10 text-slate-300 mb-3 mx-auto" />
                    <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">
                      Open Parameters to select metrics
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── PAGE: Trajectory Plots ── */}
            {activeTab === 'trends' && (
              <div className="space-y-10">
                {visibleSummaryData.length === 0 ? (
                  <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center flex flex-col items-center">
                    <LineChartIcon className="w-12 h-12 text-slate-200 mb-4" />
                    <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">Select parameters to plot</p>
                  </div>
                ) : (
                  Object.keys(measuresByUnit).map(unit => renderPlot(unit, measuresByUnit[unit]))
                )}
              </div>
            )}

            {/* ── PAGE: Composition ── */}
            {activeTab === 'composition' && (() => {
              // ── Build all combined entries: { value, label, batchId } ────────
              const allEntries = filteredChartData.map(row => {
                const raw = String(row.date);
                const dateMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
                const timeMatch = raw.match(/\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/);
                const batchMatch = raw.match(/\(Batch ([^)]+)\)/);
                const dateStr = dateMatch
                  ? new Date(dateMatch[1]).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  : raw;
                const timeStr = timeMatch ? timeMatch[1] : '';
                const batchId = batchMatch ? batchMatch[1] : 'Unknown';
                // Label: "Batch 13853 · 08 Apr 2024  14:05"
                const label = `Batch ${batchId}  ·  ${dateStr}${timeStr ? '  ' + timeStr : ''}`;
                return { value: row.date, label, batchId };
              });

              // ── Filter by search term ────────────────────────────────────────
              const searchTerm = batchSearch.trim().toLowerCase();
              const filteredEntries = searchTerm
                ? allEntries.filter(e => e.batchId.toLowerCase().includes(searchTerm))
                : allEntries;

              // ── Auto-select: keep current if still in list, else pick first ──
              const validVals = new Set(filteredEntries.map(e => e.value));
              const activeDate = validVals.has(selectedCompositionDate)
                ? selectedCompositionDate
                : (filteredEntries[0]?.value ?? '');

              // ── Row + breakdown for selected entry ───────────────────────────
              const selectedRow = filteredChartData.find(r => r.date === activeDate) ?? null;

              const measureCols = visibleSummaryData.map((s, i) => ({
                key: s.measure,
                color: COLORS[i % COLORS.length],
              }));

              const breakdown = measureCols
                .map(m => ({ ...m, value: selectedRow ? selectedRow[m.key] : null }))
                .filter(m => m.value !== null && m.value !== undefined);

              const total = breakdown.reduce((s, m) => s + m.value, 0);

              // Determine which pie dataset to use based on mode
              const activePieData = pieViewMode === 'mean' ? meanPiePerUnit : piePerUnit;

              return (
                <div className="space-y-6">
                  {visibleSummaryData.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center flex flex-col items-center">
                      <PieChartIcon className="w-12 h-12 text-slate-200 mb-4" />
                      <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">Select parameters to view composition</p>
                    </div>
                  ) : (
                    Object.keys(activePieData).map(unit => {
                      const slices = activePieData[unit];
                      const pieTotal = slices.reduce((s, e) => s + e.value, 0);
                      const pieMax = slices[0]?.value ?? 1;
                      return (
                        <div key={unit} className="space-y-4">

                          {/* ── TOP ROW: Pie (left) + Breakdown (right) ── */}
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

                            {/* ── LEFT: Pie Chart ── */}
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-200 flex flex-col items-center hover:shadow-xl transition-shadow">
                              <div className="text-center mb-6 w-full border-b border-slate-100 pb-5 flex flex-wrap items-center justify-between gap-4">
                                <div>
                                  <h4 className="text-2xl font-black text-slate-800 dark:text-slate-200 text-left">
                                    {pieViewMode === 'mean' ? 'Mean Composition' : 'Latest Sample'}
                                  </h4>
                                  <span className="text-sm font-black text-indigo-500 bg-indigo-50 px-4 py-1 rounded-full mt-2 inline-block uppercase tracking-widest">
                                    {unit}
                                  </span>
                                </div>
                                {/* View mode dropdown */}
                                <div className="relative">
                                  <select
                                    id="pie-view-mode"
                                    value={pieViewMode}
                                    onChange={e => setPieViewMode(e.target.value)}
                                    className="appearance-none bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2 pl-3 pr-9 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-black text-xs cursor-pointer hover:border-slate-300 transition-colors uppercase tracking-widest"
                                  >
                                    <option value="latest">Latest Sample</option>
                                    <option value="mean">Mean (Average)</option>
                                  </select>
                                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-indigo-500" />
                                </div>
                              </div>
                              <div className="w-full h-[400px]">
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Tooltip
                                      formatter={v => `${v.toFixed(2)} ${unit}`}
                                      contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px' }}
                                      itemStyle={{ fontWeight: 700 }}
                                    />
                                    <Pie data={slices} cx="50%" cy="50%"
                                      innerRadius={90} outerRadius={140} paddingAngle={4}
                                      dataKey="value" stroke="none">
                                      {slices.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                    </Pie>
                                    <Legend wrapperStyle={{ fontSize: 13, fontWeight: 700, paddingTop: 20 }} />
                                  </PieChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* ── RIGHT: Search + Dropdown + Breakdown Table ── */}
                            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-shadow flex flex-col overflow-hidden">

                              {/* Header */}
                              <div className="px-7 pt-7 pb-5 border-b border-slate-100 space-y-4">

                                {/* Title row */}
                                <div className="flex items-center justify-between">
                                  <h4 className="text-2xl font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5 text-indigo-500" />
                                    Sample Breakdown
                                  </h4>
                                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full uppercase tracking-widest">
                                    {filteredEntries.length} / {allEntries.length}
                                  </span>
                                </div>

                                {/* Search box */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                    <Layers className="w-3 h-3" /> Search by Batch No.
                                  </label>
                                  <div className="relative">
                                    <input
                                      type="text"
                                      value={batchSearch}
                                      onChange={e => {
                                        setBatchSearch(e.target.value);
                                        setSelectedCompositionDate(''); // reset so first match is auto-selected
                                      }}
                                      placeholder="e.g. 13853"
                                      className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2.5 pl-10 pr-4 rounded-xl focus:outline-none focus:ring-4 focus:ring-violet-500/20 focus:border-violet-500 font-bold text-sm placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 transition-colors"
                                    />
                                    <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400 pointer-events-none" />
                                    {batchSearch && (
                                      <button
                                        onClick={() => { setBatchSearch(''); setSelectedCompositionDate(''); }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors font-black text-xs leading-none"
                                      >✕</button>
                                    )}
                                  </div>
                                  {searchTerm && filteredEntries.length === 0 && (
                                    <p className="text-[11px] text-rose-400 font-bold mt-1">No batches match "{searchTerm}"</p>
                                  )}
                                </div>

                                {/* Combined dropdown: Batch No · Date */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Select Sample
                                  </label>
                                  <div className="relative">
                                    <select
                                      value={activeDate}
                                      onChange={e => setSelectedCompositionDate(e.target.value)}
                                      disabled={filteredEntries.length === 0}
                                      className="w-full appearance-none bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2.5 pl-4 pr-9 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-sm cursor-pointer hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {filteredEntries.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500" />
                                  </div>
                                </div>

                              </div>

                              {/* Column headers */}
                              <div className="grid grid-cols-[1fr_100px_64px] gap-x-3 px-6 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-100 flex-shrink-0">
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Nutrient</span>
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right">Value</span>
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right">Share</span>
                              </div>

                              {/* Scrollable rows */}
                              <div className="overflow-y-auto flex-1 divide-y divide-slate-50 dark:divide-slate-800" style={{ maxHeight: '420px' }}>
                                {!selectedRow ? (
                                  <div className="py-16 text-center text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">
                                    No data for selected date.
                                  </div>
                                ) : breakdown.length === 0 ? (
                                  <div className="py-16 text-center text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">
                                    No measurements on this date.
                                  </div>
                                ) : (
                                  breakdown.map((m, idx) => {
                                    const pct = total > 0 ? (m.value / total) * 100 : 0;
                                    const barW = breakdown[0].value > 0 ? (m.value / breakdown[0].value) * 100 : 0;
                                    return (
                                      <div key={m.key}
                                        className={`grid grid-cols-[1fr_100px_64px] gap-x-3 items-center px-6 py-3 transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 ${idx % 2 !== 0 ? 'bg-slate-50/40 dark:bg-slate-800/20' : ''}`}>
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                                            <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300 truncate" title={measureLabel(m.key)}>{measureLabel(m.key)}</span>
                                          </div>
                                          <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${barW}%`, backgroundColor: m.color, opacity: 0.7 }} />
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <span className="text-[13px] font-black text-slate-800 dark:text-slate-200 tabular-nums">{Number(m.value).toFixed(2)}</span>
                                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold ml-1">{unit}</span>
                                        </div>
                                        <div className="text-right">
                                          <span className="text-[12px] font-black tabular-nums px-2 py-0.5 rounded-lg"
                                            style={{ color: m.color, backgroundColor: m.color + '18' }}>
                                            {pct.toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>

                              {/* Footer */}
                              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 dark:bg-slate-950 flex justify-between items-center flex-shrink-0">
                                <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                  {breakdown.length} measured · Total
                                </span>
                                <span className="text-sm font-black text-slate-800 dark:text-slate-200 tabular-nums">
                                  {total.toFixed(2)} <span className="text-slate-400 dark:text-slate-500 font-semibold">{unit}</span>
                                </span>
                              </div>
                            </div>

                          </div>


                          {/* ── FULL-WIDTH: Composition Values Table (pie data) ── */}
                          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-shadow overflow-hidden">
                            {/* Header */}
                            <div className="px-7 pt-6 pb-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <h4 className="text-xl font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                  <PieChartIcon className="w-5 h-5 text-indigo-500" />
                                  Composition Values
                                  <span className="text-sm font-black text-indigo-500 bg-indigo-50 px-3 py-0.5 rounded-full uppercase tracking-widest ml-1">{unit}</span>
                                </h4>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">
                                  {pieViewMode === 'mean'
                                    ? 'Mean (average) value per nutrient · powering the pie chart above'
                                    : 'Latest measured value per nutrient · powering the pie chart above'}
                                </p>
                              </div>
                              <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                {slices.length} nutrients
                              </span>
                            </div>

                            {/* Col headers */}
                            <div className="grid grid-cols-[32px_1fr_130px_70px] gap-x-3 px-6 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-100">
                              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">#</span>
                              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Nutrient</span>
                              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right">Latest Value</span>
                              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right">Share</span>
                            </div>

                            {/* Scrollable rows */}
                            <div className="overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800" style={{ maxHeight: '320px' }}>
                              {slices.map((entry, idx) => {
                                const pct = pieTotal > 0 ? (entry.value / pieTotal) * 100 : 0;
                                const barW = pieMax > 0 ? (entry.value / pieMax) * 100 : 0;
                                return (
                                  <div key={entry.name}
                                    className={`grid grid-cols-[32px_1fr_130px_70px] gap-x-3 items-center px-6 py-3 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 transition-colors ${idx % 2 !== 0 ? 'bg-slate-50/30 dark:bg-slate-800/20' : ''}`}>
                                    <span className="text-[11px] font-black text-slate-300 dark:text-slate-600 tabular-nums">{idx + 1}</span>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                                        <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300 truncate" title={measureLabel(entry.name)}>{measureLabel(entry.name)}</span>
                                      </div>
                                      <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-500"
                                          style={{ width: `${barW}%`, backgroundColor: entry.fill, opacity: 0.75 }} />
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <span className="text-[13px] font-black text-slate-800 dark:text-slate-200 tabular-nums">{entry.value.toFixed(2)}</span>
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold ml-1">{unit}</span>
                                    </div>
                                    <div className="text-right">
                                      <span className="text-[12px] font-black tabular-nums px-2 py-0.5 rounded-lg"
                                        style={{ color: entry.fill, backgroundColor: entry.fill + '18' }}>
                                        {pct.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 dark:bg-slate-950 flex justify-between items-center text-xs">
                              <span className="font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                {slices.length} nutrients · Total
                              </span>
                              <span className="font-black text-slate-800 dark:text-slate-200 tabular-nums text-sm">
                                {pieTotal.toFixed(2)} <span className="text-slate-400 dark:text-slate-500 font-semibold">{unit}</span>
                              </span>
                            </div>
                          </div>


                        </div>

                      );
                    })
                  )}
                </div>
              );
            })()}

          </div>
        )}

      </div>
    </div>
  );
}

// ── tiny inline icons ─────────────────────────────────────────────────────────
function ChevronDown({ className = '' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function Sparkles({ className = '' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
function Layers({ className = '' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

