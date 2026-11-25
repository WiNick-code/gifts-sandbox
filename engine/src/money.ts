// Деньги считаем в копейках, чтобы не ловить ошибки округления float.
export const toKop = (rub: number): number => Math.round(rub * 100);
export const fromKop = (kop: number): number => kop / 100;

export const formatRub = (rub: number): string =>
  rub.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
