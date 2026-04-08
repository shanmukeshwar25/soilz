import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Brush
} from 'recharts';
import {
  Leaf, Box, ArrowUpRight, ArrowDownRight,
  Activity, PieChart as PieChartIcon,
  BarChart3, LineChart as LineChartIcon, LayoutDashboard, TrendingUp, X, Calendar, SlidersHorizontal
} from 'lucide-react';
import { getFilters, getTimeSeriesData, getSummaryStats, getDateRange } from '../services/api';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#14b8a6',
  '#f43f5e', '#d946ef', '#0ea5e9', '#eab308', '#2dd4bf', '#fb923c'
];

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
  const [displayUnit, setDisplayUnit] = useState('kg/ha');

  const [chartData, setChartData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [cropDateRange, setCropDateRange] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedMeasures, setSelectedMeasures] = useState(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // ── initial filter load ──
  useEffect(() => {
    getFilters().then(data => {
      setFilters(data);
      if (data.crops.length)      setSelectedCrop(data.crops[0]);
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

  // ── precise windows from dataset planting cycles ──
  const availableWindows = useMemo(() => {
    if (!cropDateRange || !Array.isArray(cropDateRange) || cropDateRange.length === 0) return [];

    return cropDateRange.map(w => {
      const s = new Date(w.start);
      const e = new Date(w.end);
      return {
        label: fmtWindow(s, e),
        value: `${w.start}|${w.end}`,
        s: s,
        e: e,
      };
    });
  }, [cropDateRange]);

  // ── dynamic unit conversion ──
  const derivedChartData = useMemo(() => {
    if (displayUnit === 'kg/ha') return chartData;
    return chartData.map(d => {
      const newD = { ...d };
      Object.keys(newD).forEach(k => {
        if (typeof newD[k] === 'number') newD[k] = newD[k] * 1000;
      });
      return newD;
    });
  }, [chartData, displayUnit]);

  const derivedSummaryData = useMemo(() => {
    if (displayUnit === 'kg/ha') return summaryData;
    return summaryData.map(s => ({
      ...s,
      latest: s.latest * 1000,
      average: s.average * 1000,
      min: s.min * 1000,
      max: s.max * 1000,
      unit: 'g/ha'
    }));
  }, [summaryData, displayUnit]);

  // ── filtered chart data ──
  const filteredChartData = useMemo(() => {
    if (selectedWindow === 'All') return derivedChartData;
    const win = availableWindows.find(w => w.value === selectedWindow);
    if (!win) return derivedChartData;
    return derivedChartData.filter(d => {
      const m = String(d.date).match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return true;
      const dtVal = new Date(m[1]);
      return dtVal >= win.s && dtVal <= win.e;
    });
  }, [derivedChartData, selectedWindow, availableWindows]);

  // ── sidebar helpers ──
  const sortedSummaryData = useMemo(() =>
    [...derivedSummaryData].sort((a, b) => b.latest - a.latest).filter(s => s.max > 0),
    [derivedSummaryData]
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
      const u = stat.unit || 'Unknown Unit';
      if (!g[u]) g[u] = [];
      g[u].push({ ...stat, color: COLORS[i % COLORS.length] });
    });
    return g;
  }, [visibleSummaryData]);

  const piePerUnit = useMemo(() => {
    const g = {};
    visibleSummaryData.filter(s => s.latest > 0).forEach((s, i) => {
      const u = s.unit || 'Unknown Unit';
      if (!g[u]) g[u] = [];
      g[u].push({ name: s.measure, value: s.latest, fill: COLORS[i % COLORS.length] });
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => b.value - a.value));
    return g;
  }, [visibleSummaryData]);

  const observationText = useMemo(() => {
    if (!visibleSummaryData.length)
      return 'No parameters selected. Open the parameter drawer on the right to begin.';
    const highest     = [...visibleSummaryData].sort((a, b) => b.latest - a.latest)[0];
    const mostVolatile = [...visibleSummaryData].sort((a, b) => (b.max - b.min) - (a.max - a.min))[0];
    const winLabel = selectedWindow !== 'All'
      ? ` (window: ${availableWindows.find(w => w.value === selectedWindow)?.label ?? selectedWindow})`
      : '';
    return `Observing ${visibleSummaryData.length} parameter(s) for ${selectedCrop} · ${selectedSoil}${winLabel}. ` +
      `Highest concentration: ${highest.measure} at ${highest.latest.toFixed(1)} ${highest.unit}. ` +
      `Most volatile: ${mostVolatile.measure} ranging ${mostVolatile.min.toFixed(1)}–${mostVolatile.max.toFixed(1)} ${mostVolatile.unit}.`;
  }, [visibleSummaryData, selectedCrop, selectedSoil, selectedWindow, availableWindows]);
function CustomTooltip({ active, payload, label, unit }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const dateStr = formatTooltipLabel(label);
    
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_20px_40px_-8px_rgba(0,0,0,0.14)] p-5 min-w-[280px]">
        <div className="border-b border-slate-100 pb-3 mb-3">
          <h4 className="font-extrabold text-slate-800 text-[13px]">{dateStr}</h4>
          {data.Crop && data.SoilType && (
            <p className="text-[11px] font-black text-slate-400 mt-1.5 uppercase tracking-wider">
              {data.Crop} · {data.SoilType}
            </p>
          )}
          {data.CropStartDate && data.CropEndDate && (
            <div className="mt-1 flex items-center gap-1.5 font-bold text-[11px] text-slate-500">
              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">Planted: {data.CropStartDate}</span>
              <span className="text-slate-300">→</span>
              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">End: {data.CropEndDate}</span>
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
                <div className="font-black text-slate-700">
                  {val} <span className="text-[11px] text-slate-400 font-semibold">{unit}</span>
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
    if (plotType === 'bar')  ChartComponent = BarChart;
    if (plotType === 'area') ChartComponent = AreaChart;

    const tooltipEl = (
      <Tooltip
        cursor={{ strokeDasharray: '4 4', strokeWidth: 1.5, stroke: '#94a3b8' }}
        content={<CustomTooltip unit={unit} />}
      />
    );

    const renderSeries = () => measures.map(m => {
      if (plotType === 'bar')
        return <Bar key={m.measure} dataKey={m.measure} fill={m.color}
          radius={[5,5,0,0]} maxBarSize={40} isAnimationActive={false} />;
      if (plotType === 'area')
        return <Area key={m.measure} type="monotone" dataKey={m.measure}
          stroke={m.color} fill={m.color} fillOpacity={0.12}
          strokeWidth={2.5} connectNulls isAnimationActive={false}
          dot={{ r: 4, fill: m.color, stroke: '#fff', strokeWidth: 2 }}
          activeDot={{ r: 7, fill: m.color, stroke: '#fff', strokeWidth: 2 }} />;
      return <Line key={m.measure} type="monotone" dataKey={m.measure}
        stroke={m.color} strokeWidth={2.5} connectNulls isAnimationActive={false}
        dot={{ r: 4, fill: m.color, stroke: '#fff', strokeWidth: 2 }}
        activeDot={{ r: 7, fill: m.color, stroke: '#fff', strokeWidth: 2 }} />;
    });

    return (
      <div key={unit} className="mb-12 bg-white rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-shadow overflow-hidden">
        <div className="px-8 pt-7 pb-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-500" />
              {unit} — Nutrient Trajectory
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {measures.length} parameter(s) · {data.length} sample points
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {measures.map(m => (
              <span key={m.measure} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border"
                style={{ color: m.color, borderColor: m.color + '55', backgroundColor: m.color + '12' }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: m.color }} />
                {m.measure}
              </span>
            ))}
          </div>
        </div>

        {data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 font-bold bg-slate-50 m-6 rounded-2xl border-2 border-dashed border-slate-200">
            No data for this window.
          </div>
        ) : (
          <div className="w-full h-[550px] p-4 pr-10">
            <ResponsiveContainer width="100%" height="100%">
              <ChartComponent
                data={data}
                margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#E2E8F0" />
                
                <XAxis 
                  dataKey="date"
                  tickFormatter={tick => {
                    const d = parseDatePart(tick);
                    if (!d) return '';
                    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
                    catch { return d; }
                  }}
                  tick={{ fontSize: 12, fill: '#475569', fontWeight: 700 }}
                  tickMargin={14} 
                  axisLine={{ stroke: '#cbd5e1', strokeWidth: 1.5 }}
                  tickLine={false} 
                  interval="preserveStartEnd"
                  angle={-35} 
                  textAnchor="end" 
                  height={60} 
                />
                
                <YAxis 
                  tick={{ fontSize: 12, fill: '#475569', fontWeight: 700 }}
                  axisLine={false} 
                  tickLine={false} 
                  width={60}
                  domain={['auto', 'auto']}
                  tickFormatter={v => { const n = Number(v); return n >= 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`; }}
                  label={{
                    value: unit,
                    angle: -90,
                    position: 'insideLeft',
                    offset: 10,
                    style: { fontSize: 11, fill: '#94a3b8', fontWeight: 700 }
                  }}
                />
                
                {tooltipEl}
                
                <Legend 
                  wrapperStyle={{ paddingTop: 0, paddingBottom: 15 }} 
                  iconType="circle" 
                  iconSize={10} 
                  verticalAlign="top"
                  formatter={v => <span style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>{v}</span>} 
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
    <div className="min-h-screen bg-slate-50 font-sans relative overflow-x-hidden">

      {/* ── Parameter Sidebar ── */}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-[340px] bg-white z-50 shadow-2xl
        transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-indigo-500" /> Parameters
              </h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                Sorted by latest value ↓
              </p>
            </div>
            <button onClick={() => setIsSidebarOpen(false)}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
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
                    ${checked ? 'bg-indigo-50/50 border-indigo-200' : 'border-transparent hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={checked}
                    className="mt-1 w-5 h-5 rounded-md text-indigo-600 border-slate-300 cursor-pointer"
                    onChange={() => toggleMeasure(stat.measure)} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${checked ? 'font-black text-indigo-900' : 'font-semibold text-slate-600'}`}>
                      {stat.measure}
                    </p>
                    <div className="mt-1 flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-400 uppercase">#{idx + 1}</span>
                      <span className="text-[11px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">
                        {stat.latest.toFixed(1)} {stat.unit}
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
            {sortedSummaryData.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-10 uppercase tracking-widest font-bold">No variables.</p>
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
        <header className="mb-8 flex flex-col xl:flex-row justify-between items-center bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 gap-6">
          <div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-slate-900 flex items-center gap-4">
              <Leaf className="w-10 h-10 text-emerald-500 shrink-0" />
              Soil Analytics
            </h1>
            <p className="text-slate-500 mt-3 text-base font-semibold max-w-xl leading-relaxed">
              Historical soil nutrient tracking across crops and soil types — normalized to {displayUnit}.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap justify-end gap-4">
            {/* Unit */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1">Unit</label>
              <div className="relative">
                <select value={displayUnit} onChange={e => setDisplayUnit(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-slate-100 text-slate-700 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-rose-500/20 focus:border-rose-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  <option value="kg/ha">kg/ha</option>
                  <option value="g/ha">g/ha</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-500" />
              </div>
            </div>

            {/* Chart type */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1">
                <LineChartIcon className="w-3.5 h-3.5" /> Chart Type
              </label>
              <div className="relative">
                <select value={plotType} onChange={e => setPlotType(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-slate-100 text-slate-700 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  <option value="line">Line</option>
                  <option value="bar">Bar</option>
                  <option value="area">Area</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500" />
              </div>
            </div>



            {/* Timeline focus */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Timeline Focus
              </label>
              <div className="relative">
                <select value={selectedWindow} onChange={e => setSelectedWindow(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-slate-100 text-slate-700 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-black hover:border-slate-300 cursor-pointer text-sm min-w-[190px]">
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
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1">Crop</label>
              <div className="relative">
                <select value={selectedCrop} onChange={e => setSelectedCrop(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-slate-100 text-slate-700 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  {filters.crops.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
              </div>
            </div>

            {/* Soil */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1">Soil Type</label>
              <div className="relative">
                <select value={selectedSoil} onChange={e => setSelectedSoil(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-slate-100 text-slate-700 py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-500 font-black hover:border-slate-300 cursor-pointer text-sm">
                  {filters.soil_types.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500" />
              </div>
            </div>
          </div>
        </header>

        {/* Sticky Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-3 rounded-2xl shadow-sm border border-slate-200 mb-8 sticky top-4 z-30 gap-3">
          <div className="flex gap-2 overflow-x-auto p-1">
            {[
              { key: 'summary',     label: 'Insight Cards',     icon: <LayoutDashboard className="w-4 h-4" /> },
              { key: 'trends',      label: 'Trajectory Plots',  icon: <TrendingUp className="w-4 h-4" /> },
              { key: 'composition', label: 'Composition Split',  icon: <PieChartIcon className="w-4 h-4" /> },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[14px] transition-all whitespace-nowrap
                  ${activeTab === tab.key ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
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
          <div className="flex flex-col items-center justify-center py-48 bg-white rounded-3xl border border-slate-100">
            <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
            <p className="mt-6 text-slate-400 font-bold tracking-widest uppercase text-sm">Loading data…</p>
          </div>
        ) : summaryData.length === 0 ? (
          <div className="bg-white p-24 rounded-3xl text-center border border-slate-100 flex flex-col items-center">
            <Box className="w-20 h-20 text-slate-200 mb-6" />
            <h3 className="text-2xl font-black text-slate-700">No data found</h3>
            <p className="text-slate-400 mt-3 max-w-md">No measurements recorded for this crop / soil combination.</p>
          </div>
        ) : (
          <div className="space-y-8">

            {/* Observation banner */}
            <div className="bg-white border-l-8 border-indigo-500 border border-slate-200 p-7 rounded-3xl shadow-sm relative overflow-hidden">
              <div className="absolute -top-6 -right-6 opacity-[0.04]">
                <Activity className="w-48 h-48" />
              </div>
              <p className="text-[11px] font-black text-indigo-800 uppercase tracking-widest mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" /> Observations
              </p>
              <p className="text-slate-700 font-semibold leading-relaxed text-base max-w-4xl">{observationText}</p>
            </div>

            {/* ── PAGE: Summary Cards ── */}
            {activeTab === 'summary' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                {visibleSummaryData.map(stat => {
                  const up = stat.latest >= stat.average;
                  return (
                    <div key={stat.measure}
                      className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                      <div className="flex justify-between items-start gap-2 mb-4">
                        <h3 className="text-sm font-black text-slate-700 line-clamp-3 leading-snug" title={stat.measure}>
                          {stat.measure}
                        </h3>
                        <div className={`p-2 rounded-xl shrink-0 ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {up ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        </div>
                      </div>
                      <div className="flex items-end gap-1.5">
                        <span className="text-4xl font-black text-slate-900 tracking-tighter leading-none">
                          {stat.latest.toFixed(1)}
                        </span>
                      </div>
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-1.5 block pb-4 border-b border-slate-100">
                        {stat.unit}
                      </span>
                      <div className="mt-4 flex justify-between text-xs font-bold text-slate-500">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase block mb-0.5">Mean</span>
                          <span className="text-slate-800 text-base">{stat.average.toFixed(1)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 uppercase block mb-0.5">Peak</span>
                          <span className="text-slate-800 text-base">{stat.max.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {visibleSummaryData.length === 0 && (
                  <div className="col-span-full bg-white p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center">
                    <SlidersHorizontal className="w-10 h-10 text-slate-300 mb-3 mx-auto" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
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
                  <div className="bg-white p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center flex flex-col items-center">
                    <LineChartIcon className="w-12 h-12 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Select parameters to plot</p>
                  </div>
                ) : (
                  Object.keys(measuresByUnit).map(unit => renderPlot(unit, measuresByUnit[unit]))
                )}
              </div>
            )}

            {/* ── PAGE: Composition ── */}
            {activeTab === 'composition' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {Object.keys(piePerUnit).length === 0 ? (
                  <div className="col-span-full bg-white p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center flex flex-col items-center">
                    <PieChartIcon className="w-12 h-12 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Select parameters to view composition</p>
                  </div>
                ) : (
                  Object.keys(piePerUnit).map(unit => (
                    <div key={unit} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 flex flex-col items-center hover:shadow-xl transition-shadow">
                      <div className="text-center mb-6 w-full border-b border-slate-100 pb-5">
                        <h4 className="text-2xl font-black text-slate-800">Composition</h4>
                        <span className="text-sm font-black text-indigo-500 bg-indigo-50 px-4 py-1 rounded-full mt-2 inline-block uppercase tracking-widest">
                          {unit}
                        </span>
                      </div>
                      <div className="w-full h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip
                              formatter={v => `${v.toFixed(2)} ${unit}`}
                              contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px' }}
                              itemStyle={{ fontWeight: 700 }}
                            />
                            <Pie data={piePerUnit[unit]} cx="50%" cy="50%"
                              innerRadius={90} outerRadius={140} paddingAngle={4}
                              dataKey="value" stroke="none">
                              {piePerUnit[unit].map((e, i) => <Cell key={i} fill={e.fill} />)}
                            </Pie>
                            <Legend wrapperStyle={{ fontSize: 13, fontWeight: 700, paddingTop: 20 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

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
