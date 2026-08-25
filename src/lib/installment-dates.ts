/**
 * Calendário e rateio de parcelas.
 *
 * Módulo PURO e sem imports: é a única fonte da matemática financeira e roda
 * nos dois lados — no wizard, para pré-visualizar as parcelas, e no endpoint
 * api/commercial/close-contract.ts, que grava de fato. Duplicar essa lógica
 * abriria espaço para o preview mostrar um valor e o banco gravar outro.
 *
 * Todas as datas são strings YYYY-MM-DD, tratadas em UTC para nunca sofrerem
 * deslocamento de fuso.
 */

/** Fuso de negócio do Grupo Grapiúna (usado para definir "hoje"). */
export const BUSINESS_TIME_ZONE = 'America/Bahia';

const pad = (n: number): string => String(n).padStart(2, '0');

const parseDate = (date: string): { y: number; m: number; d: number } => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
};

const formatDate = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

/** Último dia do mês (month de 1 a 12). Dia 0 do mês seguinte = último do atual. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Valida o formato e a existência da data no calendário. */
export function isValidBusinessDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { y, m, d } = parseDate(date);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOfMonth(y, m);
}

/** Data de hoje no fuso de negócio. 'en-CA' formata como YYYY-MM-DD. */
export function todayBusinessDate(timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Soma meses preservando o dia, com recorte no último dia do mês de destino.
 *
 * É aqui que mora a armadilha citada no guia: `new Date(y, m + 1, 31)` para
 * 31/01 devolveria 03/03, "pulando" fevereiro. Aqui, 2026-01-31 + 1 mês vira
 * 2026-02-28 — e como o cálculo parte sempre da data original, +2 meses volta
 * a ser 2026-03-31, sem arrastar o recorte adiante.
 */
export function addMonthsClamped(date: string, months: number): string {
  const { y, m, d } = parseDate(date);
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  // Módulo protegido contra valores negativos
  const nm = ((totalMonths % 12) + 12) % 12 + 1;
  return formatDate(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

/** Soma (ou subtrai, com valor negativo) dias corridos. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Vencimentos mensais a partir da primeira data.
 * Cada parcela é calculada a partir da data ORIGINAL — nunca encadeando sobre
 * a anterior, o que faria um recorte em fevereiro contaminar todos os meses
 * seguintes.
 */
export function generateDueDates(firstDueDate: string, count: number): string[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => addMonthsClamped(firstDueDate, i));
}

/**
 * Período de vigência. A data final é o dia anterior ao mesmo dia do mês de
 * término, para um contrato de 12 meses iniciado em 25/08/2026 terminar em
 * 24/08/2027 — e não invadir um dia do período seguinte.
 */
export function computeContractPeriod(
  startDate: string,
  durationMonths: number,
): { startDate: string; endDate: string } {
  return {
    startDate,
    endDate: addDays(addMonthsClamped(startDate, durationMonths), -1),
  };
}

/**
 * Divide o total em parcelas inteiras de centavos cuja soma é EXATAMENTE o
 * total. Os centavos que sobram da divisão vão para as primeiras parcelas,
 * prática comum no comércio — assim R$ 1.000,00 em 3× vira 333,34 + 333,33 +
 * 333,33, e nunca R$ 0,01 a mais ou a menos no contrato.
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.round(totalCents));
  const base = Math.floor(safeTotal / count);
  const remainder = safeTotal - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Parcela pronta para gravação/preview. */
export interface PlannedInstallment {
  number: number;
  dueDate: string;
  amountCents: number;
}

/**
 * Plano completo de parcelas: junta rateio e calendário num só lugar, para o
 * wizard e o servidor produzirem exatamente o mesmo resultado.
 */
export function buildInstallmentPlan(
  totalCents: number,
  count: number,
  firstDueDate: string,
): PlannedInstallment[] {
  const amounts = splitInstallments(totalCents, count);
  const dates = generateDueDates(firstDueDate, count);
  return amounts.map((amountCents, i) => ({
    number: i + 1,
    dueDate: dates[i],
    amountCents,
  }));
}
