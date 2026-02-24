/**
 * KST (Asia/Seoul) 기준 날짜 유틸리티
 */

/** KST 기준 오늘 날짜 문자열 (YYYY-MM-DD) */
export function getKSTTodayString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** KST 기준 오늘 자정 Date 객체 (비교용 — @db.Date 저장에는 사용 금지) */
export function getKSTMidnight(): Date {
  const kstToday = getKSTTodayString();
  return new Date(kstToday + 'T00:00:00+09:00');
}

/** Date 객체를 KST 기준 YYYY-MM-DD 문자열로 변환 */
export function toKSTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** YYYY-MM-DD 문자열을 KST 자정 Date 객체로 파싱 (비교용 — @db.Date 저장에는 사용 금지) */
export function parseKSTDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+09:00');
}

/**
 * YYYY-MM-DD → UTC 자정 Date (@db.Date 필드 저장/쿼리용)
 *
 * Prisma @db.Date 필드는 node-postgres가 로컬 TZ 기준으로 date part를 추출하므로,
 * Docker UTC 환경에서는 반드시 UTC 자정으로 저장해야 날짜가 밀리지 않는다.
 */
export function parseDateForDB(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

/** KST 기준 오늘의 UTC 자정 Date (@db.Date 필드 저장/쿼리용) */
export function getKSTTodayForDB(): Date {
  return parseDateForDB(getKSTTodayString());
}
