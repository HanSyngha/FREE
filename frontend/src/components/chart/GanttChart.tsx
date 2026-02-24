/**
 * GanttChart - Gantt 차트 (ONCE에서 이식, FREE 스타일 적용)
 */
import { useState, useEffect, useRef } from 'react';

type ViewMode = 'week' | 'month' | 'year';

interface GanttItem {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  completed?: boolean;
  progress?: number;
  color?: string;
}

interface GanttChartProps {
  items: GanttItem[];
  onToggle?: (item: GanttItem) => void;
  onUpdate?: (id: string, data: { title?: string; startDate?: string; endDate?: string }) => void;
  onDelete?: (id: string) => void;
  editable?: boolean;
}

const BAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-indigo-500',
];

// ─── Date helpers ───

function getWeekRange(date: Date) {
  const day = date.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function getMonthRange(date: Date) {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  };
}

function getYearRange(date: Date) {
  return {
    start: new Date(date.getFullYear(), 0, 1),
    end: new Date(date.getFullYear(), 11, 31),
  };
}

function getTimelineRange(view: ViewMode, date: Date) {
  if (view === 'week') return getWeekRange(date);
  if (view === 'month') return getMonthRange(date);
  return getYearRange(date);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function navigateDate(date: Date, view: ViewMode, direction: number): Date {
  const d = new Date(date);
  if (view === 'week') d.setDate(d.getDate() + direction * 7);
  else if (view === 'month') d.setMonth(d.getMonth() + direction);
  else d.setFullYear(d.getFullYear() + direction);
  return d;
}

function getViewLabel(view: ViewMode, date: Date): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Seoul' };
  if (view === 'week') {
    const { start, end } = getWeekRange(date);
    return `${start.toLocaleDateString('ko-KR', { ...opts, month: 'short', day: 'numeric' })} — ${end.toLocaleDateString('ko-KR', { ...opts, month: 'short', day: 'numeric' })}`;
  }
  if (view === 'month') return date.toLocaleDateString('ko-KR', { ...opts, year: 'numeric', month: 'long' });
  return date.toLocaleDateString('ko-KR', { ...opts, year: 'numeric' });
}

function getTimelineColumns(view: ViewMode, date: Date): { label: string; date: Date }[] {
  const { start, end } = getTimelineRange(view, date);
  const cols: { label: string; date: Date }[] = [];
  if (view === 'week') {
    const d = new Date(start);
    while (d <= end) {
      cols.push({ label: d.toLocaleDateString('ko-KR', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Seoul' }), date: new Date(d) });
      d.setDate(d.getDate() + 1);
    }
  } else if (view === 'month') {
    const d = new Date(start);
    while (d <= end) {
      cols.push({ label: `${d.getDate()}`, date: new Date(d) });
      d.setDate(d.getDate() + 1);
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const md = new Date(date.getFullYear(), m, 1);
      cols.push({ label: md.toLocaleDateString('ko-KR', { month: 'short', timeZone: 'Asia/Seoul' }), date: md });
    }
  }
  return cols;
}

function getBarStyle(item: GanttItem, view: ViewMode, date: Date): { left: string; width: string } | null {
  const { start: tlStart, end: tlEnd } = getTimelineRange(view, date);
  const totalDays = daysBetween(tlStart, tlEnd) + 1;
  const itemStart = new Date(item.startDate); itemStart.setHours(0, 0, 0, 0);
  const itemEnd = new Date(item.endDate); itemEnd.setHours(0, 0, 0, 0);
  if (itemEnd < tlStart || itemStart > tlEnd) return null;
  const clampedStart = itemStart < tlStart ? tlStart : itemStart;
  const clampedEnd = itemEnd > tlEnd ? tlEnd : itemEnd;
  const offsetDays = daysBetween(tlStart, clampedStart);
  const spanDays = daysBetween(clampedStart, clampedEnd) + 1;
  const left = (offsetDays / totalDays) * 100;
  const width = (spanDays / totalDays) * 100;
  return { left: `${left}%`, width: `${Math.max(width, 100 / totalDays)}%` };
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' });
}

// ─── Main Component ───

export default function GanttChart({ items, onToggle, onUpdate, onDelete, editable = false }: GanttChartProps) {
  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns = getTimelineColumns(view, currentDate);
  const { start: tlStart, end: tlEnd } = getTimelineRange(view, currentDate);
  const totalDays = daysBetween(tlStart, tlEnd) + 1;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayOffset = today >= tlStart && today <= tlEnd
    ? (daysBetween(tlStart, today) / totalDays) * 100 : null;

  const incompleteItems = items.filter(i => !i.completed);
  const completedItems = items.filter(i => i.completed);

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        표시할 항목이 없습니다
      </div>
    );
  }

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-3 bg-gray-50 rounded-lg p-2">
        <div className="flex gap-1">
          {(['week', 'month', 'year'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {v === 'week' ? '주' : v === 'month' ? '월' : '년'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentDate(new Date())}
            className="px-2 py-0.5 rounded text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100">
            오늘
          </button>
          <button onClick={() => setCurrentDate(prev => navigateDate(prev, view, -1))}
            className="p-1 rounded hover:bg-gray-200">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-xs font-medium text-gray-700 min-w-[140px] text-center">
            {getViewLabel(view, currentDate)}
          </span>
          <button onClick={() => setCurrentDate(prev => navigateDate(prev, view, 1))}
            className="p-1 rounded hover:bg-gray-200">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Timeline header */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <div className="w-48 flex-shrink-0 px-3 py-2 text-xs font-semibold text-gray-400 uppercase border-r border-gray-200">
              항목
            </div>
            <div className="flex-1 flex">
              {columns.map((col, i) => {
                const isToday = todayOffset !== null && col.date.toDateString() === today.toDateString();
                return (
                  <div key={i} className={`flex-1 text-center py-2 text-xs border-r border-gray-100 last:border-r-0 ${
                    isToday ? 'bg-primary-50 font-bold text-primary-600' : 'text-gray-400'
                  }`}>
                    {col.label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Incomplete */}
        {incompleteItems.length > 0 && (
          <div>
            <div className="px-3 py-1 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-400">미완료 ({incompleteItems.length})</span>
            </div>
            {incompleteItems.map((item, idx) => (
              <GanttRow key={item.id} item={item} colorClass={item.color || BAR_COLORS[idx % BAR_COLORS.length]}
                view={view} currentDate={currentDate} columns={columns} todayOffset={todayOffset}
                isEditing={editingId === item.id} editable={editable}
                onStartEdit={() => setEditingId(item.id)} onCancelEdit={() => setEditingId(null)}
                onToggle={onToggle} onUpdate={onUpdate ? (id, data) => { onUpdate(id, data); setEditingId(null); } : undefined}
                onDelete={onDelete} />
            ))}
          </div>
        )}

        {/* Completed */}
        {completedItems.length > 0 && (
          <div>
            <div className={`px-3 py-1 bg-gray-50 border-b border-gray-100 ${incompleteItems.length > 0 ? 'border-t border-t-gray-200' : ''}`}>
              <span className="text-xs font-semibold text-gray-400">완료 ({completedItems.length})</span>
            </div>
            {completedItems.map((item) => (
              <GanttRow key={item.id} item={item} colorClass="bg-gray-400"
                view={view} currentDate={currentDate} columns={columns} todayOffset={todayOffset}
                isEditing={editingId === item.id} editable={editable}
                onStartEdit={() => setEditingId(item.id)} onCancelEdit={() => setEditingId(null)}
                onToggle={onToggle} onUpdate={onUpdate ? (id, data) => { onUpdate(id, data); setEditingId(null); } : undefined}
                onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Gantt Row ───

function GanttRow({ item, colorClass, view, currentDate, columns, todayOffset, isEditing, editable,
  onStartEdit, onCancelEdit, onToggle, onUpdate, onDelete,
}: {
  item: GanttItem; colorClass: string; view: ViewMode; currentDate: Date;
  columns: { label: string; date: Date }[]; todayOffset: number | null;
  isEditing: boolean; editable: boolean;
  onStartEdit: () => void; onCancelEdit: () => void;
  onToggle?: (item: GanttItem) => void;
  onUpdate?: (id: string, data: { title?: string; startDate?: string; endDate?: string }) => void;
  onDelete?: (id: string) => void;
}) {
  const [editTitle, setEditTitle] = useState(item.title);
  const [editStart, setEditStart] = useState(item.startDate.split('T')[0]);
  const [editEnd, setEditEnd] = useState(item.endDate.split('T')[0]);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isEditing && titleRef.current) titleRef.current.focus(); }, [isEditing]);
  useEffect(() => {
    setEditTitle(item.title);
    setEditStart(item.startDate.split('T')[0]);
    setEditEnd(item.endDate.split('T')[0]);
  }, [item]);

  const barStyle = getBarStyle(item, view, currentDate);

  const handleSave = () => {
    const updates: { title?: string; startDate?: string; endDate?: string } = {};
    if (editTitle !== item.title) updates.title = editTitle;
    if (editStart !== item.startDate.split('T')[0]) updates.startDate = editStart;
    if (editEnd !== item.endDate.split('T')[0]) updates.endDate = editEnd;
    if (Object.keys(updates).length > 0) onUpdate?.(item.id, updates);
    else onCancelEdit();
  };

  return (
    <div className="flex border-b border-gray-100 last:border-b-0 group hover:bg-gray-50/50 transition-colors">
      {/* Label column */}
      <div className="w-48 flex-shrink-0 px-2 py-2 border-r border-gray-100 flex items-center gap-1.5">
        {onToggle && (
          <button onClick={() => onToggle(item)} className="flex-shrink-0">
            {item.completed ? (
              <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
              </svg>
            ) : (
              <div className={`w-3.5 h-3.5 rounded-full border-2 ${colorClass.replace('bg-', 'border-')}`} />
            )}
          </button>
        )}

        {isEditing && editable ? (
          <div className="flex-1 min-w-0 space-y-1">
            <input ref={titleRef} value={editTitle} onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancelEdit(); }}
              className="w-full text-xs px-1 py-0.5 rounded border border-gray-300 focus:ring-1 focus:ring-primary-500" />
            <div className="flex gap-1">
              <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)}
                className="text-xs px-1 py-0.5 rounded border border-gray-300 w-[100px]" />
              <span className="text-xs text-gray-400 self-center">~</span>
              <input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                className="text-xs px-1 py-0.5 rounded border border-gray-300 w-[100px]" />
            </div>
            <div className="flex gap-1">
              <button onClick={handleSave} className="p-0.5 rounded hover:bg-green-100 text-green-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </button>
              <button onClick={onCancelEdit} className="p-0.5 rounded hover:bg-red-100 text-red-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-1">
            <span className={`text-xs truncate ${item.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`} title={item.title}>
              {item.title}
            </span>
            {editable && (
              <>
                <button onClick={onStartEdit}
                  className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 text-gray-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                </button>
                {onDelete && (
                  <button onClick={() => { if (confirm('삭제하시겠습니까?')) onDelete(item.id); }}
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-500">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bar area */}
      <div className="flex-1 relative py-2">
        <div className="absolute inset-0 flex">
          {columns.map((_, i) => (
            <div key={i} className="flex-1 border-r border-gray-50 last:border-r-0" />
          ))}
        </div>
        {todayOffset !== null && (
          <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: `${todayOffset}%` }} />
        )}
        {barStyle && (
          <div className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md ${item.completed ? 'bg-gray-300' : colorClass} opacity-85 hover:opacity-100 transition-opacity shadow-sm`}
            style={{ left: barStyle.left, width: barStyle.width }}
            title={`${item.title}\n${formatShortDate(new Date(item.startDate))} ~ ${formatShortDate(new Date(item.endDate))}`}>
            <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-medium text-white truncate">
              {item.title}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
