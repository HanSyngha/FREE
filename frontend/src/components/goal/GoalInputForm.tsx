/**
 * GoalInputForm - 조직장 목표 입력 (자유 텍스트 → LLM)
 */
import { useState } from 'react';
import { goalsApi } from '../../services/api';

interface GoalInputFormProps {
  level: string;
  ownerId: string;
  onCreated: () => void;
}

export default function GoalInputForm({ level, ownerId, onCreated }: GoalInputFormProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const levelLabel = level === 'TEAM' ? '팀' : level === 'GROUP' ? '그룹' : '파트';

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await goalsApi.create(text, level, ownerId);
      setText('');
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error || '목표 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {levelLabel} 목표 입력
      </h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`${levelLabel} 목표를 자유롭게 입력하세요. AI가 자동으로 분리하고 상위 목표에 매핑합니다.`}
        disabled={submitting}
        maxLength={10000}
        className="w-full h-24 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y
                   focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                   disabled:bg-gray-50 placeholder:text-gray-400"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{text.length.toLocaleString()} / 10,000</span>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg
                     hover:bg-primary-700 disabled:opacity-50 transition-all"
        >
          {submitting ? 'AI가 분석 중...' : '목표 등록'}
        </button>
      </div>
      {submitting && (
        <div className="flex items-center gap-2 mt-2 text-sm text-primary-600">
          <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          AI가 목표를 분리하고 상위 목표에 매핑하고 있습니다...
        </div>
      )}
      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}
    </div>
  );
}
