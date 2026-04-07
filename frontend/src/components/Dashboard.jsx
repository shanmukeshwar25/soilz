import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush,
  PieChart, Pie, Cell
} from 'recharts';
import { 
  Leaf, Box, Droplets, ArrowUpRight, ArrowDownRight, 
  Activity, PieChart as PieChartIcon, CheckSquare, 
  BarChart3, LineChart as LineChartIcon, LayoutDashboard, TrendingUp, Menu, X, Calendar, SlidersHorizontal
} from 'lucide-react';
import { getFilters, getTimeSeriesData, getSummaryStats } from '../services/api';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#14b8a6',
  '#f43f5e', '#d946ef', '#0ea5e9', '#eab308', '#2dd4bf', '#fb923c'
];

export default function Dashboard() {
  const [filters, setFilters] = useState({ crops: [], soil_types: [], measures: [] });
  const [selectedCrop, setSelectedCrop] = useState('');
  const [selectedSoil, setSelectedSoil] = useState('');
  const [plotType, setPlotType] = useState('line');
  const [activeTab, setActiveTab] = useState('summary');
  const [selectedYear, setSelectedYear] = useState('All');
  
  const [chartData, setChartData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedMeasures, setSelectedMeasures] = useState(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Initialize Filters
  useEffect(() => {
    async function loadFilters() {
      try {
        const data = await getFilters();
        setFilters(data);
        if (data.crops.length > 0) setSelectedCrop(data.crops[0]);
        if (data.soil_types.length > 0) setSelectedSoil(data.soil_types[0]);
      } catch (err) {
        console.error("Error loading filters", err);
      }
    }
    loadFilters();
  }, []);

  // Fetch Data when filters change
  useEffect(() => {
    if (!selectedCrop || !selectedSoil) return;

    async function loadData() {
      setLoading(true);
      try {
        const [tData, sData] = await Promise.all([
          getTimeSeriesData(selectedCrop, selectedSoil),
          getSummaryStats(selectedCrop, selectedSoil)
        ]);
        
        // Filter out zero-values entirely. Sort strictly descending.
        const meaningfulStats = sData
            .filter(s => s.latest > 0 || s.max > 0) // if entirely 0, omit.
            .sort((a,b) => b.latest - a.latest);
        
        setChartData(tData);
        setSummaryData(meaningfulStats);
        setSelectedYear('All'); // Reset year on new load
        
        // Select top 6 parameters by default
        if (meaningfulStats.length > 0) {
            setSelectedMeasures(new Set(meaningfulStats.slice(0, 6).map(s => s.measure)));
        } else {
            setSelectedMeasures(new Set());
        }
      } catch (err) {
        console.error("Error fetching crop data", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedCrop, selectedSoil]);

  // Handle Time Windows
  const availableWindows = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    
    const sortedDates = [...chartData].map(d => new Date(d.date)).sort((a,b) => a-b);
    const start = sortedDates[0];
    const end = sortedDates[sortedDates.length - 1];
    
    const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    
    if (diffMonths <= 8) {
       const years = new Set(chartData.map(d => d.date && d.date.split('-')[0]).filter(Boolean));
       return Array.from(years).sort().map(y => ({ label: `${y} Period`, value: `${y}` }));
    }
    
    const windows = [];
    let current = new Date(start);
    while (current <= end) {
       const wStart = new Date(current);
       const wEnd = new Date(current);
       wEnd.setMonth(wEnd.getMonth() + 3);
       
       const startStr = `${wStart.getFullYear()}-${String(wStart.getMonth()+1).padStart(2,'0')}`;
       const endStr = `${wEnd.getFullYear()}-${String(wEnd.getMonth()+1).padStart(2,'0')}`;
       windows.push({ label: `${startStr} to ${endStr}`, value: `${startStr}|${endStr}`, s: wStart, e: wEnd });
       current = wEnd;
    }
    return windows;
  }, [chartData]);

  const filteredChartData = useMemo(() => {
    if (selectedYear === 'All') return chartData;
    
    if (selectedYear.includes('|')) {
       // It's a month window
       const [sStr, eStr] = selectedYear.split('|');
       const winFind = availableWindows.find(w => w.value === selectedYear);
       if (winFind) {
          return chartData.filter(d => {
             const dt = new Date(d.date);
             return dt >= winFind.s && dt < winFind.e;
          });
       }
    }
    // Generic year fallback
    return chartData.filter(d => d.date && d.date.startsWith(selectedYear));
  }, [chartData, selectedYear, availableWindows]);

  // Sidebar logic
  const sortedSummaryData = useMemo(() => {
     // Ensure any parameter that has 0 latest value is at bottom or excluded if too many
     return [...summaryData].sort((a,b) => b.latest - a.latest).filter(s => s.latest > 0 || s.max > 0);
  }, [summaryData]);

  const toggleMeasure = (m) => {
    const next = new Set(selectedMeasures);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    setSelectedMeasures(next);
  };

  const toggleAll = () => {
    if (selectedMeasures.size === sortedSummaryData.length) {
      setSelectedMeasures(new Set());
    } else {
      setSelectedMeasures(new Set(sortedSummaryData.map(s => s.measure)));
    }
  };

  const visibleSummaryData = useMemo(() => {
    return sortedSummaryData.filter(s => selectedMeasures.has(s.measure));
  }, [sortedSummaryData, selectedMeasures]);

  // Group selected measures by unit to plot separately
  const measuresByUnit = useMemo(() => {
     const grouped = {};
     visibleSummaryData.forEach((stat, index) => {
         const u = stat.unit || 'Unknown Unit';
         if (!grouped[u]) grouped[u] = [];
         grouped[u].push({ ...stat, color: COLORS[index % COLORS.length] });
     });
     return grouped;
  }, [visibleSummaryData]);

  const piePerUnit = useMemo(() => {
      const grouped = {};
      visibleSummaryData.filter(s => s.latest > 0).forEach((s, idx) => {
          const u = s.unit || 'Unknown Unit';
          if (!grouped[u]) grouped[u] = [];
          grouped[u].push({ name: s.measure, value: s.latest, fill: COLORS[idx % COLORS.length] });
      });
      Object.keys(grouped).forEach(k => grouped[k].sort((a,b) => b.value - a.value));
      return grouped;
  }, [visibleSummaryData]);

  const observationText = useMemo(() => {
     if (visibleSummaryData.length === 0) return "No parameters selected for observation. Open the parameters menu to select nutrients.";
     
     const highest = [...visibleSummaryData].sort((a,b) => b.latest - a.latest)[0];
     const mostVolatile = [...visibleSummaryData].sort((a,b) => (b.max - b.min) - (a.max - a.min))[0];
     const yrTxt = selectedYear !== 'All' ? ` in ${selectedYear}` : '';
     
     return `Observing ${visibleSummaryData.length} active parameter(s) for ${selectedCrop} in ${selectedSoil} soil${yrTxt}. 
     Currently, ${highest.measure} records the highest concentration at ${highest.latest.toFixed(1)} ${highest.unit}. 
     Historically, the most volatile nutrient measured is ${mostVolatile.measure}, fluctuating between ${mostVolatile.min.toFixed(1)} and ${mostVolatile.max.toFixed(1)} ${mostVolatile.unit}.`;
  }, [visibleSummaryData, selectedCrop, selectedSoil, selectedYear]);

  // Helper to render plot
  const renderPlot = (unit, measures) => {
    const sharedProps = { data: filteredChartData, margin: { top: 30, right: 30, left: 20, bottom: 20 } };
    
    let ChartComponent = LineChart;
    if (plotType === 'bar') ChartComponent = BarChart;
    if (plotType === 'area') ChartComponent = AreaChart;

    return (
      <div key={unit} className="mb-12 bg-white p-6 md:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 hover:shadow-xl transition-shadow w-full">
         <div className="mb-8 border-b border-slate-100 pb-4 flex justify-between items-end">
            <div>
              <h3 className="text-2xl font-black text-slate-800 capitalize tracking-tight flex items-center gap-2">
                 <TrendingUp className="w-6 h-6 text-indigo-500" />
                 {unit} Measurements {selectedYear !== 'All' ? `(${selectedYear})` : ''}
              </h3>
              <p className="text-sm text-slate-500 mt-2 font-semibold">Isolated view scaled appropriately for {unit} variables. Displaying {measures.length} metrics.</p>
            </div>
         </div>
         {filteredChartData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-400 font-bold bg-slate-50 rounded-2xl border border-dashed border-slate-200">
               No temporal data specifically found for the year {selectedYear}.
            </div>
         ) : (
           <div className="h-[600px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ChartComponent {...sharedProps}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(tick) => tick.split(' ')[0]} 
                    tick={{ fontSize: 13, fill: '#475569', fontWeight: 700 }}
                    tickMargin={20}
                    axisLine={{ stroke: '#cbd5e1', strokeWidth: 2 }}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 13, fill: '#475569', fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                    width={65}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip 
                    cursor={{ strokeDasharray: '4 4', strokeWidth: 2, stroke: '#94a3b8' }}
                    contentStyle={{ borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '20px', backgroundColor: 'rgba(255, 255, 255, 0.98)' }}
                    itemStyle={{ fontWeight: 700, fontSize: '14px', paddingTop: '8px' }}
                    labelStyle={{ fontWeight: 800, color: '#0f172a', marginBottom: '12px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '30px' }} iconType="circle" iconSize={12} />

                  {measures.map((m) => {
                     if (plotType === 'bar') {
                        return <Bar key={m.measure} dataKey={m.measure} fill={m.color} radius={[4, 4, 0, 0]} maxBarSize={60} />;
                     }
                     if (plotType === 'area') {
                        return <Area key={m.measure} type="basis" dataKey={m.measure} fill={m.color} stroke={m.color} fillOpacity={0.4} strokeWidth={2} connectNulls />;
                     }
                     return (
                        <Line 
                          key={m.measure} type="basis" dataKey={m.measure} stroke={m.color} 
                          strokeWidth={4} dot={false} activeDot={{ r: 8, strokeWidth: 0 }} connectNulls
                        />
                     );
                  })}
                </ChartComponent>
              </ResponsiveContainer>
           </div>
         )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans relative overflow-x-hidden">
      
      {/* Sliding Sidebar for Parameters */}
      <div 
         className={`fixed top-0 right-0 h-full w-full sm:w-[350px] bg-white z-50 shadow-[0_0_50px_rgba(0,0,0,0.1)] transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
               <div>
                 <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                   <SlidersHorizontal className="w-5 h-5 text-indigo-500" />
                   Measurements
                 </h3>
                 <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Sorted descending</p>
               </div>
               <button 
                 onClick={() => setIsSidebarOpen(false)}
                 className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
               >
                 <X className="w-6 h-6" />
               </button>
            </div>
            
            <div className="px-6 py-4 flex-shrink-0">
               <button 
                   onClick={toggleAll}
                   className="w-full font-bold bg-indigo-50 text-indigo-700 py-3 rounded-xl hover:bg-indigo-100 transition-colors uppercase tracking-widest text-sm"
               >
                 {selectedMeasures.size === sortedSummaryData.length ? 'Deselect All' : 'Select All Visible'}
               </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2 custom-scrollbar">
               {sortedSummaryData.map((stat, idx) => {
                 const isChecked = selectedMeasures.has(stat.measure);
                 return (
                   <label 
                     key={stat.measure} 
                     className={`flex items-start gap-3 p-4 rounded-2xl cursor-pointer transition-all border-2 ${isChecked ? 'bg-indigo-50/40 border-indigo-200 shadow-sm' : 'border-transparent hover:bg-slate-50'}`}
                   >
                      <input 
                        type="checkbox" 
                        className="mt-1 w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer"
                        checked={isChecked}
                        onChange={() => toggleMeasure(stat.measure)}
                      />
                      <div className="flex flex-col flex-1">
                         <span className={`text-[15px] leading-tight ${isChecked ? 'font-black text-indigo-950' : 'font-semibold text-slate-600'}`}>
                           {stat.measure}
                         </span>
                         <div className="mt-1.5 flex justify-between items-center w-full">
                           <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                             RANK: #{idx + 1}
                           </span>
                           <span className="text-xs font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded uppercase">
                             {stat.latest.toFixed(1)} {stat.unit}
                           </span>
                         </div>
                      </div>
                   </label>
                 );
               })}
               {sortedSummaryData.length === 0 && (
                   <div className="text-sm text-slate-400 font-bold text-center py-10 uppercase tracking-widest">No variables present.</div>
               )}
            </div>
        </div>
      </div>
      
      {/* Background Overlay when Sidebar is open */}
      {isSidebarOpen && (
          <div 
             className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 transition-opacity" 
             onClick={() => setIsSidebarOpen(false)}
          />
      )}

      {/* Main Container */}
      <div className="p-4 md:p-8 max-w-[1920px] mx-auto pb-20">
        
        {/* Header Ribbon */}
        <header className="mb-8 flex flex-col xl:flex-row justify-between items-center bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-200">
          <div className="text-center xl:text-left flex-1">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-slate-900 flex items-center justify-center xl:justify-start gap-4">
              <Leaf className="w-10 h-10 text-emerald-500 shrink-0" />
              Soil Analytics View
            </h1>
            <p className="text-slate-500 mt-4 text-sm md:text-[17px] font-semibold max-w-2xl leading-relaxed">
              Dynamically analyzing historical soil nutrition compounds and visual trajectories over distinct harvesting periods.
            </p>
          </div>
          
          {/* Main Selectors */}
          <div className="mt-8 xl:mt-0 flex flex-wrap justify-center xl:justify-end gap-4 w-full xl:w-auto">
            
            <div className="flex flex-col text-left">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1 flex items-center gap-1.5">
                  <LineChartIcon className="w-3.5 h-3.5" /> Display Graph
              </label>
              <div className="relative">
                <select 
                  value={plotType} 
                  onChange={e => setPlotType(e.target.value)}
                  className="appearance-none w-full bg-slate-50 border-2 border-slate-100 text-slate-700 py-3.5 pl-5 pr-14 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-black hover:border-slate-300 cursor-pointer capitalize transition-all text-sm"
                >
                  <option value="line">Line Series</option>
                  <option value="bar">Bar Heights</option>
                  <option value="area">Area Volume</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-indigo-500">
                   <ChevronDown className="w-5 h-5"/>
                </div>
              </div>
            </div>

            <div className="flex flex-col text-left">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Timeline Focus
              </label>
              <div className="relative">
                <select 
                  value={selectedYear} 
                  onChange={e => setSelectedYear(e.target.value)}
                  className="appearance-none w-full bg-slate-50 border-2 border-slate-100 text-slate-700 py-3.5 pl-5 pr-14 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-black hover:border-slate-300 cursor-pointer transition-all text-sm"
                >
                  <option value="All">Complete History</option>
                  {availableWindows.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-blue-500">
                  <ChevronDown className="w-5 h-5"/>
                </div>
              </div>
            </div>

            <div className="flex flex-col text-left">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Crop Type</label>
              <div className="relative">
                <select 
                  value={selectedCrop} 
                  onChange={e => setSelectedCrop(e.target.value)}
                  className="appearance-none w-full bg-slate-50 border-2 border-slate-100 text-slate-700 py-3.5 pl-5 pr-14 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 font-black hover:border-slate-300 cursor-pointer transition-all text-sm"
                >
                  {filters.crops.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-emerald-500">
                  <ChevronDown className="w-5 h-5"/>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col text-left">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Soil Type</label>
              <div className="relative">
                <select 
                  value={selectedSoil} 
                  onChange={e => setSelectedSoil(e.target.value)}
                  className="appearance-none w-full bg-slate-50 border-2 border-slate-100 text-slate-700 py-3.5 pl-5 pr-14 rounded-2xl focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-500 font-black hover:border-slate-300 cursor-pointer transition-all text-sm"
                >
                  {filters.soil_types.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-orange-500">
                  <ChevronDown className="w-5 h-5"/>
                </div>
              </div>
            </div>

          </div>
        </header>

        {/* Global Action Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-200 mb-8 sticky top-4 z-30">
            {/* View Tabs */}
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto custom-scrollbar p-1">
              <button 
                 onClick={() => setActiveTab('summary')}
                 className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-[15px] transition-all focus:outline-none whitespace-nowrap ${activeTab === 'summary' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                 <LayoutDashboard className="w-4 h-4 text-emerald-400" /> Insight Cards
              </button>
              <button 
                 onClick={() => setActiveTab('trends')}
                 className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-[15px] transition-all focus:outline-none whitespace-nowrap ${activeTab === 'trends' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                 <TrendingUp className="w-4 h-4 text-blue-400" /> Trajectory Plots
              </button>
              <button 
                 onClick={() => setActiveTab('composition')}
                 className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-[15px] transition-all focus:outline-none whitespace-nowrap ${activeTab === 'composition' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                 <PieChartIcon className="w-4 h-4 text-orange-400" /> Split Compositions
              </button>
            </div>

            {/* Toggle Parameters Button */}
            <button
               onClick={() => setIsSidebarOpen(true)}
               className="mt-3 sm:mt-0 w-full sm:w-auto group flex items-center justify-center gap-3 px-8 py-3.5 rounded-xl bg-indigo-50 border-2 border-indigo-100 hover:bg-indigo-600 hover:border-indigo-600 text-indigo-700 hover:text-white font-black text-[15px] transition-all shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
            >
               <SlidersHorizontal className="w-5 h-5 group-hover:animate-pulse" />
               View Variables ({selectedMeasures.size})
            </button>
        </div>

        {/* Loading State Area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-40 animate-in fade-in zoom-in duration-500 bg-white rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-20 h-20 border-[6px] border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="mt-8 text-slate-400 font-bold tracking-[0.2em] uppercase text-sm">Processing Complex Metrics...</p>
          </div>
        ) : summaryData.length === 0 ? (
          <div className="bg-white p-32 rounded-[2rem] text-center shadow-sm border border-slate-100 flex flex-col items-center justify-center">
               <Box className="w-24 h-24 text-slate-200 mb-8" />
               <h3 className="text-3xl font-black text-slate-800">No Valid Variables Existent</h3>
               <p className="text-slate-500 mt-4 text-lg font-medium max-w-xl">
                 Zero measurable quantities were found matching this Crop AND Soil query across our system.
               </p>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 block w-full space-y-8">
            
            {/* Descriptive Observation Banner */}
            <div className="bg-white border-l-8 border-l-indigo-500 border border-slate-200 p-8 rounded-[2rem] shadow-sm relative overflow-hidden">
               <div className="absolute top-[-20px] right-[-20px] opacity-5">
                   <Activity className="w-64 h-64" />
               </div>
               <h3 className="text-base font-black text-indigo-900 uppercase tracking-[0.15em] mb-3 flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  AI Synthesis & Observations
               </h3>
               <p className="text-slate-700 font-semibold leading-relaxed text-[17px] max-w-4xl relative z-10">{observationText}</p>
            </div>

            {/* Content Tabs */}
            <div className="w-full">
                
              {/* PAGE 1: SUMMARY CARDS */}
              {activeTab === 'summary' && (
                <div>
                  {selectedMeasures.size === 0 && (
                      <div className="bg-white p-12 rounded-[2rem] border-2 border-dashed border-slate-300 text-center flex flex-col items-center justify-center w-full">
                         <SlidersHorizontal className="w-12 h-12 text-slate-300 mb-4" />
                         <span className="text-slate-500 font-black tracking-widest uppercase text-base block mb-2">Variables are hidden.</span>
                         <span className="text-slate-400 font-medium text-sm">Click "View Variables" in the top right to populate insights!</span>
                      </div>
                  )}
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                    {visibleSummaryData.map((stat) => {
                      const diff = stat.latest - stat.average;
                      const isPositive = diff > 0;
                      return (
                        <div key={stat.measure} className="bg-white p-6 lg:p-8 rounded-[2rem] shadow-sm border border-slate-200 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 group">
                          <div className="flex justify-between items-start mb-6 gap-3">
                            <h3 className="text-[15px] font-black text-slate-700 line-clamp-3 leading-snug group-hover:text-indigo-600 transition-colors" title={stat.measure}>
                              {stat.measure}
                            </h3>
                            <div className={`p-2.5 rounded-2xl shrink-0 ${isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {isPositive ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                            </div>
                          </div>
                          <div className="flex items-end gap-2.5 mt-4">
                            <span className="text-5xl font-black text-slate-900 tracking-tighter leading-none">{stat.latest.toFixed(1)}</span>
                          </div>
                          <span className="text-[13px] font-black text-slate-400 uppercase tracking-widest mt-2 block w-full border-b border-slate-100 pb-4">{stat.unit}</span>
                          
                          <div className="mt-5 flex items-center justify-between text-xs font-bold text-slate-500">
                            <div className="flex-1 pr-2">
                              <span className="text-[10px] text-slate-400 uppercase tracking-widest block mb-1">Mean</span> 
                              <span className="text-slate-800 text-base">{stat.average.toFixed(1)}</span>
                            </div>
                            <div className="flex-1 pl-2 border-l border-slate-100 text-right">
                              <span className="text-[10px] text-slate-400 uppercase tracking-widest block mb-1">Peak</span> 
                              <span className="text-slate-800 text-base">{stat.max.toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PAGE 2: TREND GRAPHS */}
              {activeTab === 'trends' && (
                <div className="space-y-12 w-full">
                  {selectedMeasures.size === 0 && (
                      <div className="bg-white p-12 rounded-[2rem] border-2 border-dashed border-slate-300 text-center flex flex-col items-center justify-center w-full">
                         <LineChartIcon className="w-12 h-12 text-slate-300 mb-4" />
                         <span className="text-slate-500 font-black tracking-widest uppercase text-base block mb-2">Axes are Empty</span>
                         <span className="text-slate-400 font-medium text-sm">Activate variables from your side-drawer to witness plotting!</span>
                      </div>
                  )}
                  {Object.keys(measuresByUnit).map(unit => renderPlot(unit, measuresByUnit[unit]))}
                </div>
              )}

              {/* PAGE 3: PIE CHARTS */}
              {activeTab === 'composition' && (
                <div className="w-full">
                   {selectedMeasures.size === 0 && (
                      <div className="bg-white p-12 rounded-[2rem] border-2 border-dashed border-slate-300 text-center flex flex-col items-center justify-center w-full">
                         <PieChartIcon className="w-12 h-12 text-slate-300 mb-4" />
                         <span className="text-slate-500 font-black tracking-widest uppercase text-base block mb-2">No Parts to Make a Whole</span>
                         <span className="text-slate-400 font-medium text-sm">Enable variables to calculate composition splits!</span>
                      </div>
                   )}
                   <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 w-full">
                    {Object.keys(piePerUnit).map(unit => (
                        <div key={unit} className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200 flex flex-col items-center hover:shadow-2xl transition-shadow relative overflow-hidden">
                            <div className="text-center mb-8 relative z-10 w-full border-b border-slate-100 pb-6">
                               <h4 className="text-2xl font-black text-slate-800 tracking-tight">
                                  Volume Splits
                               </h4>
                               <span className="text-sm font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-4 py-1.5 rounded-full mt-3 inline-block">PORTIONS MEASURED IN: {unit}</span>
                            </div>
                            <div className="w-full h-[450px] relative z-10">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Tooltip 
                                     formatter={(value) => `${value.toFixed(2)} ${unit}`} 
                                     contentStyle={{ borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', padding: '20px', backgroundColor: 'rgba(255, 255, 255, 0.98)' }}
                                     itemStyle={{ fontWeight: 800, fontSize: '15px' }}
                                  />
                                  <Pie 
                                    data={piePerUnit[unit]} 
                                    cx="50%" cy="50%" 
                                    innerRadius={110} outerRadius={170} 
                                    paddingAngle={4} dataKey="value"
                                    stroke="none"
                                    cornerRadius={6}
                                  >
                                    {piePerUnit[unit].map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                  </Pie>
                                  <Legend wrapperStyle={{ fontSize: 14, fontWeight: 700, paddingTop: '30px' }} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                        </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Minimal missing component for icons
function ChevronDown(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6"/>
    </svg>
  )
}
function Sparkles(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    </svg>
  )
}
