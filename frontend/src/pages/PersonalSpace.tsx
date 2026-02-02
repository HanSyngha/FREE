/**
 * Personal Space Page - 개인 Space
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, itemsApi, ratingApi, reportsApi } from '../services/api';
import ItemBlock from '../components/common/ItemBlock';
import RatingPopup from '../components/common/RatingPopup';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

/** KST 기준 YYYY-MM-DD */
function getKSTToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function toKSTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

interface Item {
  id: string;
  title: string;
  content: string;
  link: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export default function PersonalSpace() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<Item[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState(getKSTToday());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showRating, setShowRating] = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await spacesApi.getPersonal();
      setItems(res.data.items);
      setReports(res.data.reports || []);
    } catch { } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await itemsApi.create(text, date);
      setText('');
      await fetchItems();
      // Rating 체크
      if (res.data.shouldRate) {
        setShowRating(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '정리에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: string, data: { title?: string; content?: string; link?: string; date?: string }) => {
    try {
      await itemsApi.update(id, data);
      await fetchItems();
    } catch { }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    try {
      await itemsApi.delete(id);
      await fetchItems();
    } catch { }
  };

  const handleGenerateReport = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await reportsApi.generatePersonal();
      await fetchItems();
    } catch (err: any) {
      alert(err.response?.data?.error || '보고서 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleExportReport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user?.username || '개인'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!confirm('이 보고서를 삭제하시겠습니까?')) return;
    try {
      await reportsApi.delete(reportId);
      await fetchItems();
    } catch (err: any) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  // 보고서 제목에 중복 번호 매기기
  const getReportLabel = (report: any, idx: number) => {
    const periodLabel = `${formatDateWithDay(report.periodStart)} ~ ${formatDateWithDay(report.periodEnd)}`;
    const sameperiod = reports.filter((r: any) =>
      r.periodStart.split('T')[0] === report.periodStart.split('T')[0] &&
      r.periodEnd.split('T')[0] === report.periodEnd.split('T')[0]
    );
    if (sameperiod.length > 1) {
      const num = sameperiod.indexOf(report) + 1;
      return `${user?.username} 보고서 ${periodLabel} (${num})`;
    }
    return `${user?.username} 보고서 ${periodLabel}`;
  };

  // 날짜별 그룹핑
  const groupedItems = items.reduce((acc, item) => {
    const d = item.date.split('T')[0]!;
    if (!acc[d]) acc[d] = [];
    acc[d]!.push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  const sortedDates = Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));

  // 날짜 범위 (오늘 ~ 29일 전, KST 기준)
  const today = getKSTToday();
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 29);
  const minDateStr = toKSTDateString(minDate);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">나의 업무 기록</h1>

      {/* 입력 창 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jira 이슈, 채팅 내역, 메일 본문, 회의록, 메모... 무엇이든 붙여넣으세요. AI가 자동으로 정리합니다."
          disabled={submitting}
          maxLength={50000}
          aria-label="업무 내용 입력"
          className="w-full h-32 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y
                     focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                     disabled:bg-gray-50 disabled:text-gray-400
                     placeholder:text-gray-400"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              min={minDateStr}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
            <span className="text-xs text-gray-400">{text.length.toLocaleString()} / 50,000</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg
                       hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? 'AI가 정리 중입니다...' : 'Submit'}
          </button>
        </div>

        {/* 처리 중 스피너 */}
        {submitting && (
          <div className="flex items-center gap-2 mt-3 text-sm text-primary-600">
            <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            AI가 정리 중입니다...
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}
      </div>

      {/* 개인 보고서 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">나의 주간 보고서</h2>
          <button onClick={handleGenerateReport} disabled={generating}
            className="px-4 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-all">
            {generating ? 'AI 생성 중...' : '보고서 생성'}
          </button>
        </div>
        {generating && (
          <div className="flex items-center gap-2 mb-3 text-sm text-primary-600">
            <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            AI가 보고서를 생성 중입니다...
          </div>
        )}
        {reports.length > 0 ? (
          reports.map((report: any, idx: number) => (
            <div key={report.id} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <a href={`/report/${report.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-primary-600 hover:underline">
                  {getReportLabel(report, idx)}
                </a>
                <div className="flex gap-2">
                  <button onClick={() => handleExportReport(report.id, 'docx')}
                    className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                  <button onClick={() => handleExportReport(report.id, 'xlsx')}
                    className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                  <button onClick={() => handleDeleteReport(report.id)}
                    className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-md hover:bg-red-100">삭제</button>
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>생성: {new Date(report.createdAt).toLocaleString('ko-KR')}</span>
                <span>자동 삭제: {new Date(report.expiresAt).toLocaleDateString('ko-KR')}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-gray-400">생성된 보고서가 없습니다. 버튼을 눌러 생성하세요.</p>
        )}
      </div>

      {/* Item 목록 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-1">아직 등록된 항목이 없습니다</p>
          <p className="text-sm">위 입력 창에 업무 내용을 입력해 보세요</p>
        </div>
      ) : (
        sortedDates.map(dateKey => (
          <div key={dateKey} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3 px-1">{dateKey}</h2>
            <div className="space-y-3">
              {groupedItems[dateKey]!.map(item => (
                <ItemBlock
                  key={item.id}
                  item={item}
                  editable
                  onUpdate={(data) => handleUpdate(item.id, data)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Rating Popup */}
      <RatingPopup
        isOpen={showRating}
        onClose={() => setShowRating(false)}
      />
    </div>
  );
}
