/**
 * KST (Asia/Seoul) 기준 날짜 유틸리티
 */

/** KST 기준 오늘 날짜 문자열 (YYYY-MM-DD) */
export function getKSTTodayString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** KST 기준 오늘 자정 Date 객체 */
export function getKSTMidnight(): Date {
  const kstToday = getKSTTodayString();
  return new Date(kstToday + 'T00:00:00+09:00');
}

/** Date 객체를 KST 기준 YYYY-MM-DD 문자열로 변환 */
export function toKSTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
