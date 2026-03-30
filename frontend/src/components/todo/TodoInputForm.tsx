/**
 * TodoInputForm - Todo 직접 추가 폼
 */
import { useState } from 'react';
import { todosApi } from '../../services/api';

interface TodoInputFormProps {
  onCreated: () => void;
}

export default function TodoInputForm({ onCreated }: TodoInputFormProps) {
  const [title, setTitle] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await todosApi.create({ title: title.trim(), endDate: endDate || undefined });
      setTitle('');
      setEndDate('');
      onCreated();
    } catch (err: any) {
      alert(err.response?.data?.error || '할일 추가에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <input value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="할일 추가..."
        disabled={submitting}
        className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-gray-400 disabled:opacity-50" />
      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
        className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 w-[120px]" />
      <button onClick={handleSubmit} disabled={!title.trim() || submitting}
        className="text-xs px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">
        {submitting ? '...' : '추가'}
      </button>
    </div>
  );
}
