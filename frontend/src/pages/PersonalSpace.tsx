/**
 * Personal Space Page - 개인 Space
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, itemsApi, ratingApi } from '../services/api';
import ItemBlock from '../components/common/ItemBlock';
import RatingPopup from '../components/common/RatingPopup';

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
  const [text, setText] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]!);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showRating, setShowRating] = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await spacesApi.getPersonal();
      setItems(res.data.items);
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

  // 날짜별 그룹핑
  const groupedItems = items.reduce((acc, item) => {
    const d = item.date.split('T')[0]!;
    if (!acc[d]) acc[d] = [];
    acc[d]!.push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  const sortedDates = Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));

  // 날짜 범위 (오늘 ~ 29일 전)
  const today = new Date().toISOString().split('T')[0]!;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 29);
  const minDateStr = minDate.toISOString().split('T')[0]!;

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
