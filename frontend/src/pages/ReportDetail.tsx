/**
 * Report Detail Page
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { reportsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isSuperAdmin, isTeamAdmin } = useAuthStore();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    reportsApi.getById(id).then(res => setReport(res.data.report)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('이 보고서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
      await reportsApi.delete(id);
      alert('보고서가 삭제되었습니다.');
      window.close();
    } catch (err: any) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  const handleExport = async (format: 'docx' | 'xlsx') => {
    if (!id) return;
    try {
      const res = await reportsApi.export(id, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const typeStr = report?.type === 'PART' ? '파트' : report?.type === 'GROUP' ? '그룹' : '팀';
      const dateStr = report?.periodEnd?.split('T')[0] || '';
      a.download = `${typeStr}_주간보고서_${dateStr}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!report) return <div className="text-center py-12 text-gray-400">보고서를 찾을 수 없습니다</div>;

  const typeLabel = report.type === 'PART' ? '파트' : report.type === 'GROUP' ? '그룹' : '팀';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{typeLabel} 주간 보고서</h1>
          <p className="text-sm text-gray-500">
            {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
            {' | '}생성: {new Date(report.createdAt).toLocaleString('ko-KR')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('docx')}
            className="px-4 py-2 bg-blue-50 text-blue-600 text-sm rounded-lg hover:bg-blue-100">DOCX 내보내기</button>
          <button onClick={() => handleExport('xlsx')}
            className="px-4 py-2 bg-green-50 text-green-600 text-sm rounded-lg hover:bg-green-100">XLSX 내보내기</button>
          {(isSuperAdmin || isTeamAdmin) && (
            <button onClick={handleDelete}
              className="px-4 py-2 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100">삭제</button>
          )}
        </div>
      </div>

      {/* 개인별/파트별/그룹별 정리 */}
      <div className="bg-white rounded-xl border border-gray-200 p-8 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-5">
          {report.type === 'PART' ? '개인별 업무 정리' : report.type === 'GROUP' ? '파트별 업무 정리' : '그룹별 업무 정리'}
        </h2>
        <div className="report-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.byMemberContent}</ReactMarkdown>
        </div>
      </div>

      {/* 업무 항목별 정리 */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-5">업무 항목별 정리</h2>
        <div className="report-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.byItemContent}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
