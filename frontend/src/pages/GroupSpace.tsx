/**
 * Group Space Page
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { spacesApi, reportsApi } from '../services/api';

export default function GroupSpace() {
  const { groupId } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groupId) return;
    spacesApi.getGroup(groupId).then(res => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [groupId]);

  const handleExport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.group?.name || '그룹'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400">그룹을 찾을 수 없습니다</div>;

  // items를 날짜별 → 파트별로 그룹핑
  const partMap = new Map<string, string>();
  data.parts?.forEach((p: any) => { partMap.set(p.id, p.name); });

  const groupedByDate: Record<string, Record<string, any[]>> = {};
  data.items?.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const partName = item.user?.partId ? (partMap.get(item.user.partId) || 'Unknown') : 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![partName]) groupedByDate[d]![partName] = [];
    groupedByDate[d]![partName]!.push(item);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.group?.name} 업무 기록</h1>
      <p className="text-sm text-gray-500 mb-6">{data.parts?.length || 0}개 파트</p>

      {/* 보고서 */}
      {data.reports?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">주간 보고서</h2>
          {data.reports.map((report: any) => (
            <div key={report.id} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <a href={`/report/${report.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-primary-600 hover:underline">
                  {report.periodStart.split('T')[0]} ~ {report.periodEnd.split('T')[0]}
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
            {Object.entries(groupedByDate[dateKey]!).map(([partName, partItems]) => (
              <div key={partName} className="mb-3">
                <h3 className="text-xs font-medium text-gray-600 mb-2 px-1 cursor-pointer hover:text-primary-600"
                  onClick={() => {
                    const part = data.parts?.find((p: any) => p.name === partName);
                    if (part) window.open(`/space/part/${part.id}`, '_blank');
                  }}>
                  {partName}
                </h3>
                <div className="space-y-1">
                  {(partItems as any[]).map((item: any) => (
                    <div key={item.id} className="px-3 py-2 bg-white rounded-lg border border-gray-100 cursor-pointer hover:border-primary-200 hover:bg-primary-50/30 transition-colors"
                      onClick={() => {
                        const part = data.parts?.find((p: any) => p.name === partName);
                        if (part) window.open(`/space/part/${part.id}`, '_blank');
                      }}>
                      <span className="text-sm text-gray-700">{item.title}</span>
                      <span className="text-xs text-gray-400 ml-2">{item.user?.username}</span>
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
