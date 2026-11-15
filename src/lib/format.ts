const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 名册序号：1–99 用中文数字，超过后回退为阿拉伯数字。 */
export function cnNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "零";
  const n = Math.floor(value);
  if (n < 10) return DIGITS[n];
  if (n === 10) return "十";
  if (n < 20) return `十${DIGITS[n - 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rest = n % 10;
    return `${DIGITS[tens]}十${rest ? DIGITS[rest] : ""}`;
  }
  return String(n);
}
