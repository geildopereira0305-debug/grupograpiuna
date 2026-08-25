/**
 * Teste de paridade entre a matemática financeira duplicada.
 *
 * POR QUE ISTO EXISTE: api/commercial/close-contract.ts precisa ser autocontido
 * (a Vercel não resolve import relativo em rotas ESM), então o cálculo de datas
 * e o rateio de parcelas existem em dois lugares:
 *
 *   - src/lib/installment-dates.ts  → usado pelo wizard (prévia ao vendedor)
 *   - api/commercial/close-contract.ts → usado pelo servidor (gravação real)
 *
 * Se os dois divergirem, o vendedor vê um valor e o banco grava outro. Este
 * teste compara as duas implementações em centenas de combinações.
 *
 * Rode com:  npm run test:parity
 */
import * as lib from '../src/lib/installment-dates';
import * as api from '../api/commercial/close-contract';
import * as payment from '../api/commercial/register-payment';

let failures = 0;

function compare(label: string, a: unknown, b: unknown): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    console.log(`DIVERGE  ${label}\n         lib: ${sa}\n         api: ${sb}`);
    failures++;
  }
}

/* ── addMonthsClamped: todo dia de todo mês, somando 0..12 ───────────────── */
let monthChecks = 0;
for (const year of [2026, 2027, 2028]) {
  for (let month = 1; month <= 12; month++) {
    const maxDay = lib.lastDayOfMonth(year, month);
    for (const day of [1, 15, 28, 29, 30, 31].filter((d) => d <= maxDay)) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      for (let add = 0; add <= 12; add++) {
        compare(
          `addMonthsClamped(${date}, ${add})`,
          lib.addMonthsClamped(date, add),
          api.addMonthsClamped(date, add),
        );
        monthChecks++;
      }
    }
  }
}

/* ── splitInstallments: totais variados em 1..12 parcelas ────────────────── */
let splitChecks = 0;
for (const total of [0, 1, 7, 999, 100000, 125000, 123457, 999999, 1234567890]) {
  for (let n = 1; n <= 12; n++) {
    const fromLib = lib.splitInstallments(total, n);
    const fromApi = api.splitInstallments(total, n);
    compare(`splitInstallments(${total}, ${n})`, fromLib, fromApi);
    // Invariante independente: a soma tem de fechar exatamente com o total
    const sum = fromApi.reduce((a, b) => a + b, 0);
    if (sum !== total) {
      console.log(`SOMA ERRADA  splitInstallments(${total}, ${n}) somou ${sum}`);
      failures++;
    }
    splitChecks++;
  }
}

/* ── computeContractPeriod ───────────────────────────────────────────────── */
let periodChecks = 0;
for (const start of ['2026-01-31', '2026-02-28', '2028-02-29', '2026-08-25', '2026-12-31']) {
  for (const duration of [1, 3, 6, 12]) {
    compare(
      `computeContractPeriod(${start}, ${duration})`,
      lib.computeContractPeriod(start, duration),
      api.computeContractPeriod(start, duration),
    );
    periodChecks++;
  }
}

/* ── buildInstallmentPlan (integração das duas partes) ───────────────────── */
let planChecks = 0;
for (const total of [125000, 100000, 333333]) {
  for (const n of [1, 3, 6, 12]) {
    for (const first of ['2026-01-31', '2026-11-30', '2026-12-31']) {
      compare(
        `buildInstallmentPlan(${total}, ${n}, ${first})`,
        lib.buildInstallmentPlan(total, n, first),
        api.buildInstallmentPlan(total, n, first),
      );
      planChecks++;
    }
  }
}

/* ── todayBusinessDate ───────────────────────────────────────────────────── */
compare('todayBusinessDate()', lib.todayBusinessDate(), api.todayBusinessDate());
compare('BUSINESS_TIME_ZONE', lib.BUSINESS_TIME_ZONE, api.BUSINESS_TIME_ZONE);

/* ── register-payment: mesmo relógio e mesmo calendário ──────────────────── */
compare('payment: todayBusinessDate()', lib.todayBusinessDate(), payment.todayBusinessDate());
compare('payment: BUSINESS_TIME_ZONE', lib.BUSINESS_TIME_ZONE, payment.BUSINESS_TIME_ZONE);
let paymentChecks = 2;
for (const year of [2026, 2028]) {
  for (let month = 1; month <= 12; month++) {
    compare(
      `payment: lastDayOfMonth(${year}, ${month})`,
      lib.lastDayOfMonth(year, month),
      payment.lastDayOfMonth(year, month),
    );
    paymentChecks++;
  }
}
// periodOf precisa extrair a competência exatamente como os resumos esperam
for (const [date, expected] of [
  ['2026-01-31', '2026-01'],
  ['2026-12-01', '2026-12'],
  ['2028-02-29', '2028-02'],
] as [string, string][]) {
  compare(`payment: periodOf(${date})`, payment.periodOf(date), expected);
  paymentChecks++;
}

const total = monthChecks + splitChecks + periodChecks + planChecks + 2 + paymentChecks;
console.log(
  failures === 0
    ? `\nPARIDADE OK — ${total} comparações (datas: ${monthChecks}, rateio: ${splitChecks}, vigência: ${periodChecks}, planos: ${planChecks}, baixa: ${paymentChecks})`
    : `\n${failures} DIVERGÊNCIA(S) em ${total} comparações`,
);
process.exit(failures === 0 ? 0 : 1);
