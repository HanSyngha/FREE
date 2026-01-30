/**
 * Other User's Personal Space - 읽기 전용
 */
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { spacesApi } from '../services/api';
import ItemBlock from '../components/common/ItemBlock';

export default function PersonalSpaceOther() {
  const { userId, date } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [targetUser, setTargetUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const dateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    spacesApi.getPersonalUser(userId).then(res => {
      setItems(res.data.items);
      setTargetUser(res.data.user);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [userId]);

  // 날짜 URL param에 해당하는 섹션으로 자동 스크롤
  useEffect(() => {
    if (!loading && date && dateRef.current) {
      dateRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, date]);

  const groupedItems = items.reduce((acc: any, item: any) => {
    const d = item.date.split('T')[0];
    if (!acc[d]) acc[d] = [];
    acc[d].push(item);
    return acc;
  }, {});

  const sortedDates = Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">
        {targetUser?.username}의 Space
      </h1>
      <p className="text-sm text-gray-500 mb-6">{targetUser?.loginid} | {targetUser?.partName}</p>

      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 항목이 없습니다</div>
      ) : (
        sortedDates.map(dateKey => (
          <div key={dateKey} ref={date && dateKey === date ? dateRef : undefined}
            className={`mb-6 ${date && dateKey === date ? 'ring-2 ring-primary-300 rounded-xl p-3' : ''}`}>
            <h2 className="text-sm font-semibold text-gray-500 mb-3">{dateKey}</h2>
            <div className="space-y-3">
              {groupedItems[dateKey].map((item: any) => (
                <ItemBlock key={item.id} item={item} editable={false} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
