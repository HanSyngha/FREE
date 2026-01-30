/**
 * Export Service - docx & xlsx 내보내기
 */
import {
  Document, Paragraph, TextRun, HeadingLevel, Packer,
  AlignmentType, BorderStyle,
} from 'docx';
import ExcelJS from 'exceljs';

interface ReportData {
  title: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  byMemberContent: string;
  byItemContent: string;
  type: string;
}

/**
 * DOCX 내보내기
 */
export async function exportToDocx(report: ReportData): Promise<Buffer> {
  const typeLabel = report.type === 'PART' ? '파트' : report.type === 'GROUP' ? '그룹' : '팀';

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: '맑은 고딕', size: 22 },
        },
      },
    },
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: report.title, bold: true, size: 32, font: '맑은 고딕' })],
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        // Period
        new Paragraph({
          children: [new TextRun({ text: `기간: ${report.periodStart} ~ ${report.periodEnd}`, size: 20, color: '666666' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }),
        // Created date
        new Paragraph({
          children: [new TextRun({ text: `생성일: ${report.createdAt}`, size: 20, color: '666666' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        // Separator
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
          spacing: { after: 300 },
        }),
        // Section 1
        new Paragraph({
          children: [new TextRun({
            text: report.type === 'PART' ? '개인별 업무 정리' : report.type === 'GROUP' ? '파트별 업무 정리' : '그룹별 업무 정리',
            bold: true, size: 26, font: '맑은 고딕',
          })],
          heading: HeadingLevel.HEADING_2,
          spacing: { after: 200 },
        }),
        ...report.byMemberContent.split('\n').map(line =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 22, font: '맑은 고딕' })],
            spacing: { after: 100 },
          })
        ),
        // Separator
        new Paragraph({ spacing: { before: 300, after: 300 } }),
        // Section 2
        new Paragraph({
          children: [new TextRun({ text: '업무 항목별 정리', bold: true, size: 26, font: '맑은 고딕' })],
          heading: HeadingLevel.HEADING_2,
          spacing: { after: 200 },
        }),
        ...report.byItemContent.split('\n').map(line =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 22, font: '맑은 고딕' })],
            spacing: { after: 100 },
          })
        ),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/**
 * XLSX 내보내기
 */
export async function exportToXlsx(report: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FREE';
  workbook.created = new Date();

  const memberLabel = report.type === 'PART' ? '개인별' : report.type === 'GROUP' ? '파트별' : '그룹별';

  // Sheet 1: Member-based
  const sheet1 = workbook.addWorksheet(`${memberLabel} 정리`);
  sheet1.columns = [
    { header: '구분', key: 'category', width: 20 },
    { header: '업무 내용', key: 'content', width: 80 },
  ];

  // Header styling
  sheet1.getRow(1).font = { bold: true, size: 12 };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  // Title row
  sheet1.addRow({ category: report.title, content: `${report.periodStart} ~ ${report.periodEnd}` });
  sheet1.addRow({});

  report.byMemberContent.split('\n').forEach(line => {
    if (line.trim()) {
      sheet1.addRow({ category: '', content: line });
    }
  });

  // Sheet 2: Item-based
  const sheet2 = workbook.addWorksheet('업무 항목별 정리');
  sheet2.columns = [
    { header: '업무 항목', key: 'item', width: 30 },
    { header: '상세 내용', key: 'detail', width: 80 },
  ];

  sheet2.getRow(1).font = { bold: true, size: 12 };
  sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  sheet2.addRow({ item: report.title, detail: `${report.periodStart} ~ ${report.periodEnd}` });
  sheet2.addRow({});

  report.byItemContent.split('\n').forEach(line => {
    if (line.trim()) {
      sheet2.addRow({ item: '', detail: line });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
