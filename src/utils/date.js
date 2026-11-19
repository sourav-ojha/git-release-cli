const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Supported tokens: YYYY MM DD HH mm ss (local time). */
export const TIMESTAMP_TOKEN_PATTERN = /YYYY|MM|DD|HH|mm|ss/g;

export function formatTimestamp(date, format) {
  return format.replace(TIMESTAMP_TOKEN_PATTERN, (token) => {
    switch (token) {
      case 'YYYY': return pad(date.getFullYear(), 4);
      case 'MM': return pad(date.getMonth() + 1);
      case 'DD': return pad(date.getDate());
      case 'HH': return pad(date.getHours());
      case 'mm': return pad(date.getMinutes());
      default: return pad(date.getSeconds());
    }
  });
}

/** e.g. "19 November 2026" */
export function formatLongDate(date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
