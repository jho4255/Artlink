import fs from 'fs';
import path from 'path';

// ========== ArtLink 로거 ==========
// 콘솔 + 파일 로그 동시 기록
// 로그 파일: backend/logs/app.log (일반), backend/logs/error.log (에러 전용)
// 확인 방법: tail -f backend/logs/error.log (실시간), cat backend/logs/app.log (전체)

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

// logs 디렉토리 자동 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function formatTimestamp(): string {
  return new Date().toISOString();
}

/** 로그 한 줄을 파일에 append */
function writeToFile(filename: string, message: string): void {
  try {
    const filePath = path.join(LOG_DIR, filename);

    // 간단한 로테이션: 파일이 10MB 초과 시 .old로 교체
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        fs.renameSync(filePath, filePath + '.old');
      }
    } catch {
      // 파일이 없으면 무시
    }

    fs.appendFileSync(filePath, message + '\n');
  } catch {
    // 로그 기록 실패 시 서비스에 영향 주지 않음
  }
}

/** 구조화된 로그 출력 */
function log(level: LogLevel, category: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = formatTimestamp();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  const line = `[${timestamp}] [${level}] [${category}] ${message}${metaStr}`;

  // 콘솔 출력
  switch (level) {
    case 'ERROR':
      console.error(line);
      break;
    case 'WARN':
      console.warn(line);
      break;
    case 'DEBUG':
      if (process.env.NODE_ENV !== 'production') console.log(line);
      break;
    default:
      console.log(line);
  }

  // 파일 기록
  writeToFile('app.log', line);
  if (level === 'ERROR') {
    writeToFile('error.log', line);
  }
}

export const logger = {
  info: (category: string, message: string, meta?: Record<string, unknown>) =>
    log('INFO', category, message, meta),

  warn: (category: string, message: string, meta?: Record<string, unknown>) =>
    log('WARN', category, message, meta),

  error: (category: string, message: string, meta?: Record<string, unknown>) =>
    log('ERROR', category, message, meta),

  debug: (category: string, message: string, meta?: Record<string, unknown>) =>
    log('DEBUG', category, message, meta),

  /** HTTP 요청 로그 (morgan 대체용) */
  request: (method: string, url: string, statusCode: number, durationMs: number) =>
    log(statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO',
      'HTTP', `${method} ${url} ${statusCode} ${durationMs}ms`),

  /** DB 쿼리 slow log (100ms 초과 시) */
  slowQuery: (query: string, durationMs: number) =>
    log('WARN', 'DB', `Slow query (${durationMs}ms): ${query.substring(0, 200)}`),
};

export default logger;
