/**
 * Personal Space Page - 개인 Space (Todo + WorkLog 통합)
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, workLogsApi, todosApi, ratingApi, reportsApi, profileApi } from '../services/api';
import WorkLogBlock from '../components/common/ItemBlock';
import RatingPopup from '../components/common/RatingPopup';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

function getKSTToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function toKSTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

interface WorkLog {
  id: string;
  title: string;
  content: string;
  link: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
  linkedItem?: { id: string; title: string } | null;
}

interface Todo {
  id: string;
  title: string;
  content: string;
  startDate: string | null;
  endDate: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  linkedItem?: { id: string; title: string } | null;
}

interface Preferences {
  tone?: string;
  language?: string;
  emphasis?: string;
  customInstructions?: string;
}

export default function PersonalSpace() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState(getKSTToday());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showRating, setShowRating] = useState(false);
  const [showOlderReports, setShowOlderReports] = useState(false);
  const [preferences, setPreferences] = useState<Preferences | null>(null);

  // Todo 직접 추가
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoEndDate, setTodoEndDate] = useState('');
  const [todoSubmitting, setTodoSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await spacesApi.getPersonal();
      setWorkLogs(res.data.workLogs || res.data.items || []);
      setTodos(res.data.todos || []);
      setReports(res.data.reports || []);
    } catch { } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    profileApi.getPreferences().then(res => setPreferences(res.data.preferences || {})).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await workLogsApi.create(text, date);
      setText('');
      await fetchData();
      if (res.data.shouldRate) setShowRating(true);
    } catch (err: any) {
      setError(err.response?.data?.error || '정리에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: string, data: { title?: string; content?: string; link?: string; date?: string }) => {
    try {
      await workLogsApi.update(id, data);
      await fetchData();
    } catch { }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    try {
      await workLogsApi.delete(id);
      await fetchData();
    } catch { }
  };

  // Todo handlers
  const handleToggleTodo = async (todo: Todo) => {
    try {
      await todosApi.update(todo.id, { completed: !todo.completed });
      await fetchData();
    } catch { }
  };

  const handleDeleteTodo = async (id: string) => {
    if (!confirm('이 할일을 삭제하시겠습니까?')) return;
    try {
      await todosApi.delete(id);
      await fetchData();
    } catch { }
  };

  const handleAddTodo = async () => {
    if (!todoTitle.trim() || todoSubmitting) return;
    setTodoSubmitting(true);
    try {
      await todosApi.create({
        title: todoTitle,
        endDate: todoEndDate || undefined,
      });
      setTodoTitle('');
      setTodoEndDate('');
      setShowTodoForm(false);
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || '할일 추가에 실패했습니다.');
    } finally {
      setTodoSubmitting(false);
    }
  };

  const handleGenerateReport = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await reportsApi.generatePersonal();
      await fetchData();
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
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

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

  // 날짜별 그룹핑 (WorkLog)
  const groupedItems = workLogs.reduce((acc, item) => {
    const d = item.date.split('T')[0]!;
    if (!acc[d]) acc[d] = [];
    acc[d]!.push(item);
    return acc;
  }, {} as Record<string, WorkLog[]>);

  const sortedDates = Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));

  const today = getKSTToday();
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 29);
  const minDateStr = toKSTDateString(minDate);

  // Todo 분류
  const incompleteTodos = todos.filter(t => !t.completed);
  const completedTodos = todos.filter(t => t.completed);

  const getPreferencesSummary = () => {
    if (!preferences) return null;
    const parts: string[] = [];
    if (preferences.tone) {
      const toneLabels: Record<string, string> = { formal: '격식체', concise: '간결체' };
      parts.push(toneLabels[preferences.tone] || preferences.tone);
    }
    if (preferences.language === 'english') parts.push('영어');
    if (preferences.emphasis) parts.push(`강조: ${preferences.emphasis}`);
    if (preferences.customInstructions) parts.push('추가 지시사항 있음');
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const prefSummary = getPreferencesSummary();
  const hasPreferences = prefSummary !== null;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">나의 업무 관리</h1>

      {/* 설정 안내 배너 */}
      <div className={`rounded-lg p-3 mb-4 flex items-center justify-between ${hasPreferences ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${hasPreferences ? 'text-primary-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm">
            {hasPreferences ? (
              <span className="text-primary-700">{prefSummary}</span>
            ) : (
              <span className="text-gray-500">AI 정리 스타일을 설정하면 나만의 방식으로 업무를 기록할 수 있어요</span>
            )}
          </span>
        </div>
        <Link to="/profile" className="text-xs text-primary-600 hover:underline whitespace-nowrap ml-2">
          {hasPreferences ? '설정 변경' : '설정하기'}
        </Link>
      </div>

      {/* ==================== Todo 섹션 ==================== */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            할일 ({incompleteTodos.length})
          </h2>
          <button
            onClick={() => setShowTodoForm(!showTodoForm)}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            + 할일 추가
          </button>
        </div>

        {/* Todo 추가 폼 */}
        {showTodoForm && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <input
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              placeholder="할일 제목"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2 focus:ring-1 focus:ring-primary-500"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo(); }}
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={todoEndDate}
                onChange={(e) => setTodoEndDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                placeholder="마감일"
              />
              <div className="flex-1" />
              <button onClick={() => { setShowTodoForm(false); setTodoTitle(''); setTodoEndDate(''); }}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">취소</button>
              <button onClick={handleAddTodo} disabled={!todoTitle.trim() || todoSubmitting}
                className="px-4 py-1.5 bg-primary-600 text-white text-xs rounded-lg disabled:opacity-50">
                {todoSubmitting ? '추가 중...' : '추가'}
              </button>
            </div>
          </div>
        )}

        {/* 미완료 Todo 리스트 */}
        {incompleteTodos.length === 0 && !showTodoForm ? (
          <p className="text-xs text-gray-400 py-2">등록된 할일이 없습니다</p>
        ) : (
          <div className="space-y-1">
            {incompleteTodos.map(todo => (
              <div key={todo.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                <button
                  onClick={() => handleToggleTodo(todo)}
                  className="mt-0.5 w-4 h-4 rounded border border-gray-300 hover:border-primary-500 flex-shrink-0 flex items-center justify-center transition-colors"
                  aria-label="할일 완료 토글"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-800">{todo.title}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {todo.endDate && (
                      <span className="text-xs text-gray-400">{todo.endDate.split('T')[0]}</span>
                    )}
                    {todo.linkedItem && (
                      <span className="text-xs text-primary-500 bg-primary-50 px-1.5 py-0.5 rounded">
                        {todo.linkedItem.title}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDeleteTodo(todo.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity"
                  aria-label="할일 삭제">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 완료된 Todo */}
        {completedTodos.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              완료됨 ({completedTodos.length})
            </summary>
            <div className="space-y-1 mt-1">
              {completedTodos.map(todo => (
                <div key={todo.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                  <button
                    onClick={() => handleToggleTodo(todo)}
                    className="mt-0.5 w-4 h-4 rounded border border-primary-400 bg-primary-500 flex-shrink-0 flex items-center justify-center"
                    aria-label="할일 완료 해제"
                  >
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </button>
                  <span className="text-sm text-gray-400 line-through flex-1">{todo.title}</span>
                  <button onClick={() => handleDeleteTodo(todo.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity"
                    aria-label="할일 삭제">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ==================== 입력 창 ==================== */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jira 이슈, 채팅 내역, 메일 본문, 회의록, 메모... 무엇이든 붙여넣으세요. AI가 업무 기록과 할일을 자동으로 분리합니다."
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

        {submitting && (
          <div className="flex items-center gap-2 mt-3 text-sm text-primary-600">
            <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            AI가 업무 기록과 할일을 분리하고 있습니다...
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}
      </div>

      {/* ==================== 개인 보고서 ==================== */}
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
          (() => {
            const latest = reports[0];
            const older = reports.slice(1);
            return (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span onClick={() => navigate(`/report/${latest.id}`)}
                      className="text-sm font-medium text-primary-600 hover:underline cursor-pointer">
                      {getReportLabel(latest, 0)}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => handleExportReport(latest.id, 'docx')}
                        className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                      <button onClick={() => handleExportReport(latest.id, 'xlsx')}
                        className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                      <button onClick={() => handleDeleteReport(latest.id)}
                        className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-md hover:bg-red-100">삭제</button>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>생성: {new Date(latest.createdAt).toLocaleString('ko-KR')}</span>
                    <span>자동 삭제: {new Date(latest.expiresAt).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
                {older.length > 0 && (
                  <>
                    <button onClick={() => setShowOlderReports(!showOlderReports)}
                      className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1">
                      <svg className={`w-3 h-3 transition-transform ${showOlderReports ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      이전 보고서 ({older.length})
                    </button>
                    {showOlderReports && older.map((report: any, idx: number) => (
                      <div key={report.id} className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-2">
                        <div className="flex items-center justify-between mb-2">
                          <span onClick={() => navigate(`/report/${report.id}`)}
                            className="text-sm font-medium text-gray-500 hover:text-primary-600 hover:underline cursor-pointer">
                            {getReportLabel(report, idx + 1)}
                          </span>
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
                    ))}
                  </>
                )}
              </>
            );
          })()
        ) : (
          <p className="text-xs text-gray-400">생성된 보고서가 없습니다. 버튼을 눌러 생성하세요.</p>
        )}
      </div>

      {/* ==================== WorkLog 목록 ==================== */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-1">아직 등록된 업무 기록이 없습니다</p>
          <p className="text-sm">위 입력 창에 업무 내용을 입력해 보세요</p>
        </div>
      ) : (
        sortedDates.map(dateKey => (
          <div key={dateKey} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3 px-1">{dateKey}</h2>
            <div className="space-y-3">
              {groupedItems[dateKey]!.map(item => (
                <WorkLogBlock
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

      <RatingPopup
        isOpen={showRating}
        onClose={() => setShowRating(false)}
      />
    </div>
  );
}
