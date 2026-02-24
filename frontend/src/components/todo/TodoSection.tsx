/**
 * TodoSection - Todo 리스트 + 체크박스 + 인라인 편집 + 매핑 편집
 */
import { useState } from 'react';
import { todosApi } from '../../services/api';

interface Todo {
  id: string;
  title: string;
  endDate: string;
  completed: boolean;
  linkedItemId?: string | null;
  linkedItem?: { id: string; title: string } | null;
}

interface TodoSectionProps {
  todos: Todo[];
  onUpdate: () => void;
  canEdit?: boolean;
  /** 매핑 가능한 목표 후보 목록 */
  goalCandidates?: Array<{ id: string; title: string }>;
}

export default function TodoSection({ todos, onUpdate, canEdit = false, goalCandidates }: TodoSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [mappingId, setMappingId] = useState<string | null>(null);

  const incomplete = todos.filter(t => !t.completed);
  const completed = todos.filter(t => t.completed);

  const handleToggle = async (todo: Todo) => {
    try {
      await todosApi.update(todo.id, { completed: !todo.completed });
      onUpdate();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 할일을 삭제하시겠습니까?')) return;
    try {
      await todosApi.delete(id);
      onUpdate();
    } catch {}
  };

  const handleStartEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditTitle(todo.title);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editTitle.trim()) return;
    try {
      await todosApi.update(id, { title: editTitle.trim() });
      setEditingId(null);
      onUpdate();
    } catch {}
  };

  const handleChangeMapping = async (todoId: string, linkedItemId: string | null) => {
    try {
      await todosApi.update(todoId, { linkedItemId });
      setMappingId(null);
      onUpdate();
    } catch {}
  };

  if (todos.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-sm">등록된 할일이 없습니다</div>;
  }

  const renderTodoItem = (todo: Todo, isCompleted: boolean) => (
    <div key={todo.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 group transition-colors ${isCompleted ? '' : ''}`}>
      <button onClick={() => handleToggle(todo)} className="flex-shrink-0">
        {isCompleted ? (
          <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
          </svg>
        ) : (
          <div className="w-4 h-4 rounded border-2 border-gray-300 hover:border-primary-500 transition-colors" />
        )}
      </button>
      {editingId === todo.id ? (
        <div className="flex-1 flex items-center gap-1">
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(todo.id); if (e.key === 'Escape') setEditingId(null); }}
            autoFocus className="flex-1 text-sm px-2 py-0.5 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500" />
          <button onClick={() => handleSaveEdit(todo.id)} className="text-xs text-primary-600 hover:underline">저장</button>
          <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">취소</button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <span className={`text-sm truncate block ${isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{todo.title}</span>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {todo.endDate && (
                <span className="text-xs text-gray-400">{todo.endDate.split('T')[0]}</span>
              )}
              {todo.linkedItem ? (
                <button
                  onClick={(e) => { e.stopPropagation(); if (canEdit) setMappingId(mappingId === todo.id ? null : todo.id); }}
                  className={`text-xs px-1.5 py-0.5 rounded ${canEdit ? 'text-primary-600 bg-primary-50 hover:bg-primary-100 cursor-pointer' : 'text-primary-500 bg-primary-50'}`}>
                  {todo.linkedItem.title}
                  {canEdit && <span className="ml-1 text-primary-400">x</span>}
                </button>
              ) : canEdit && goalCandidates && goalCandidates.length > 0 ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setMappingId(mappingId === todo.id ? null : todo.id); }}
                  className="text-xs text-gray-400 hover:text-primary-600 px-1.5 py-0.5 rounded border border-dashed border-gray-300 hover:border-primary-400">
                  + 목표 연결
                </button>
              ) : null}
            </div>
            {/* 매핑 드롭다운 */}
            {mappingId === todo.id && canEdit && goalCandidates && (
              <div className="mt-1">
                <select
                  onChange={e => handleChangeMapping(todo.id, e.target.value || null)}
                  className="w-full px-2 py-1 text-xs border rounded-lg">
                  <option value="">매핑 해제</option>
                  {goalCandidates.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {!isCompleted && (
            <>
              <button onClick={() => handleStartEdit(todo)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 transition-opacity">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                </svg>
              </button>
            </>
          )}
          <button onClick={() => handleDelete(todo.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-opacity">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-1">
      {/* 미완료 */}
      {incomplete.map(todo => renderTodoItem(todo, false))}

      {/* 완료 */}
      {completed.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 px-3 py-1">
            완료됨 ({completed.length})
          </summary>
          <div className="mt-1 space-y-0.5">
            {completed.map(todo => renderTodoItem(todo, true))}
          </div>
        </details>
      )}
    </div>
  );
}
