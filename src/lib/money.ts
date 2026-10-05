/** Formatea pesos colombianos sin decimales: 18500 -> "$18.500". */
export function formatCop(amount: number): string {
  const digits = Math.round(amount).toString();
  return `$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
