/**
 * Rating Popup - ONCE 패턴 참조
 * 개인별 LLM 요청 20회마다 표시
 */
import { useState, useEffect, useCallback } from 'react';
import { ratingApi } from '../../services/api';

interface RatingPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

const labels = ['별로예요', '아쉬워요', '보통이에요', '좋아요', '최고예요'];

export default function RatingPopup({ isOpen, onClose }: RatingPopupProps) {
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setHoveredStar(0);
      setSelectedRating(0);
      setSubmitted(false);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Escape 키로 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(async () => {
    if (selectedRating === 0 || submitting) return;
    setSubmitting(true);
    try {
      await ratingApi.submit(selectedRating);
    } catch (e) {
      console.error('Rating submit failed:', e);
    }
    setSubmitted(true);
    setTimeout(() => onClose(), 1200);
  }, [selectedRating, submitting, onClose]);

  if (!isOpen) return null;

  const displayRating = hoveredStar || selectedRating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="rating-dialog-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Dialog */}
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden mx-4">
        {submitted ? (
          <div className="px-6 py-10 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-900">감사합니다!</p>
          </div>
        ) : (
          <>
            <div className="px-6 pt-6 pb-2 text-center">
              <h3 id="rating-dialog-title" className="text-lg font-bold text-gray-900">서비스 평가</h3>
              <p className="mt-1 text-sm text-gray-500">AI 응답 품질은 어떠셨나요?</p>
            </div>

            {/* Stars */}
            <div className="px-6 py-5">
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const filled = star <= displayRating;
                  return (
                    <button
                      key={star}
                      onMouseEnter={() => setHoveredStar(star)}
                      onMouseLeave={() => setHoveredStar(0)}
                      onClick={() => setSelectedRating(star)}
                      aria-label={`${star}점 - ${labels[star - 1]}`}
                      aria-pressed={selectedRating === star}
                      className="p-1 transition-transform hover:scale-110 active:scale-95"
                    >
                      <svg className={`w-10 h-10 ${filled ? 'text-amber-400' : 'text-gray-300'}`}
                        fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                      </svg>
                    </button>
                  );
                })}
              </div>
              <div className="h-6 mt-2 text-center">
                {displayRating > 0 && (
                  <span className="text-sm font-medium text-gray-500">{labels[displayRating - 1]}</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">
                건너뛰기
              </button>
              <button onClick={handleSubmit}
                disabled={selectedRating === 0 || submitting}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40">
                제출
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
