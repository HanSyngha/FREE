/**
 * Part Space Page
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { spacesApi, reportsApi } from '../services/api';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

export default function PartSpace() {
  const { partId } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partId) return;
    spacesApi.getPart(partId).then(res => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [partId]);

  const handleExport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.part?.name || '파트'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400">파트를 찾을 수 없습니다</div>;

  // items를 날짜별 → 개인별로 그룹핑
  const groupedByDate: Record<string, Record<string, any[]>> = {};
  data.items?.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const userName = item.user?.username || 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![userName]) groupedByDate[d]![userName] = [];
    groupedByDate[d]![userName]!.push(item);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.part?.name} 업무 기록</h1>
      <p className="text-sm text-gray-500 mb-6">{data.users?.length || 0}명</p>

      {/* 보고서 */}
      {data.reports?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">주간 보고서</h2>
          {data.reports.map((report: any) => (
            <div key={report.id} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <a href={`/report/${report.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-primary-600 hover:underline">
                  {data.part?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
                </a>
                <div className="flex gap-2">
                  <button onClick={() => handleExport(report.id, 'docx')}
                    className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                  <button onClick={() => handleExport(report.id, 'xlsx')}
                    className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                </div>
              </div>
              <p className="text-xs text-gray-400">생성: {new Date(report.createdAt).toLocaleString('ko-KR')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Item 목록 */}
      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 항목이 없습니다</div>
      ) : (
        sortedDates.map(dateKey => (
          <div key={dateKey} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">{dateKey}</h2>
            {Object.entries(groupedByDate[dateKey]!).map(([userName, userItems]) => (
              <div key={userName} className="mb-3">
                <h3 className="text-xs font-medium text-gray-600 mb-2 px-1 cursor-pointer hover:text-primary-600"
                  onClick={() => {
                    const userItem = (userItems as any[])[0];
                    if (userItem?.user?.id) window.open(`/space/personal/${userItem.user.id}`, '_blank');
                  }}>
                  {userName}
                </h3>
                <div className="space-y-1">
                  {(userItems as any[]).map((item: any) => (
                    <div key={item.id}
                      className="px-3 py-2 bg-white rounded-lg border border-gray-100 hover:border-primary-200 hover:bg-primary-50/30 cursor-pointer transition-colors"
                      onClick={() => window.open(`/space/personal/${item.user?.id}/${dateKey}`, '_blank')}
                    >
                      <span className="text-sm text-gray-700">{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
