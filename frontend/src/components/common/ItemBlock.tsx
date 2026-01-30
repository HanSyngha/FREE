/**
 * Item Block Component
 */
import { useState } from 'react';

interface ItemBlockProps {
  item: {
    id: string;
    title: string;
    content: string;
    link: string | null;
    date: string;
  };
  editable?: boolean;
  onUpdate?: (data: { title?: string; content?: string; link?: string; date?: string }) => void;
  onDelete?: () => void;
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export default function ItemBlock({ item, editable = false, onUpdate, onDelete }: ItemBlockProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editContent, setEditContent] = useState(item.content);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState(item.link || '');

  const handleSave = () => {
    onUpdate?.({ title: editTitle, content: editContent });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditing(false);
  };

  const handleSaveLink = () => {
    if (linkValue && !isSafeUrl(linkValue)) {
      alert('유효한 URL을 입력해 주세요. (http:// 또는 https://)');
      return;
    }
    onUpdate?.({ link: linkValue });
    setShowLinkInput(false);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      {editing ? (
        /* 편집 모드 */
        <div>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            aria-label="제목 수정"
            className="w-full text-sm font-semibold text-gray-900 border-b border-gray-200 pb-1 mb-2 focus:outline-none focus:border-primary-500"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            aria-label="내용 수정"
            className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-2 min-h-[60px] resize-y focus:ring-1 focus:ring-primary-500"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleSave} className="px-3 py-1 bg-primary-600 text-white text-xs rounded-lg">저장</button>
            <button onClick={handleCancel} className="px-3 py-1 bg-gray-200 text-gray-600 text-xs rounded-lg">취소</button>
          </div>
        </div>
      ) : (
        /* 표시 모드 */
        <div>
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              {item.link && isSafeUrl(item.link) ? (
                <a href={item.link} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-semibold text-primary-600 hover:underline">{item.title}</a>
              ) : (
                <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
              )}
            </div>
            {editable && (
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => setEditing(true)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded" title="수정" aria-label="항목 수정">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                  </svg>
                </button>
                <button onClick={onDelete}
                  className="p-1 text-gray-400 hover:text-red-500 rounded" title="삭제" aria-label="항목 삭제">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
                <button onClick={() => setShowLinkInput(!showLinkInput)}
                  className="p-1 text-gray-400 hover:text-blue-500 rounded" title="링크" aria-label="링크 추가">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <p className="text-sm text-gray-600 whitespace-pre-wrap">{item.content}</p>

          <p className="text-xs text-gray-400 mt-2">{item.date.split('T')[0]}</p>

          {/* 링크 입력 팝업 */}
          {showLinkInput && editable && (
            <div className="mt-2 flex gap-2">
              <input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="URL을 입력하세요"
                className="flex-1 px-2 py-1 text-sm border rounded"
              />
              <button onClick={handleSaveLink} className="px-2 py-1 bg-primary-600 text-white text-xs rounded">저장</button>
              <button onClick={() => setShowLinkInput(false)} className="px-2 py-1 bg-gray-200 text-xs rounded">취소</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
