/**
 * Formatadores do módulo comercial.
 *
 * Fronteira única entre o BANCO (inteiros em centavos) e a TELA (reais no
 * padrão brasileiro). Nenhum componente deve converter dinheiro por conta
 * própria: erro de arredondamento em float vira divergência financeira.
 */
import type { AdFormat, PackageDuration } from './commercial-types';

/* ─── Dinheiro ───────────────────────────────────────────────────────────── */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** 125000 => "R$ 1.250,00" */
export function formatCents(cents: number): string {
  return BRL.format((cents ?? 0) / 100);
}

/** 125000 => "1.250,00" (sem o símbolo, para preencher inputs) */
export function centsToInput(cents: number): string {
  return ((cents ?? 0) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte o texto digitado em centavos inteiros.
 * Aceita "1.250,00", "1250,00", "1250.00" e "1250" — todos viram 125000.
 * Retorna 0 para entrada vazia ou inválida.
 */
export function inputToCents(input: string): number {
  if (!input) return 0;
  let cleaned = String(input).replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return 0;

  if (cleaned.includes(',')) {
    // Padrão brasileiro: ponto é separador de milhar, vírgula é decimal
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  // Arredonda no centavo para não propagar imprecisão de ponto flutuante
  return Math.round(value * 100);
}

/* ─── Durações ───────────────────────────────────────────────────────────── */

/** 1 => "1 mês" | 12 => "12 meses" */
export function formatDuration(months: PackageDuration): string {
  return months === 1 ? '1 mês' : `${months} meses`;
}

/**
 * Valor equivalente por mês — ajuda o vendedor a comparar períodos.
 * 1200000 em 12 meses => "R$ 1.000,00/mês"
 */
export function formatMonthlyEquivalent(
  totalCents: number,
  months: PackageDuration,
): string {
  if (!totalCents || !months) return '—';
  return `${formatCents(Math.round(totalCents / months))}/mês`;
}

/**
 * Desconto do período em relação a pagar o preço de 1 mês N vezes.
 * Devolve a porcentagem inteira, ou null quando não há base de comparação.
 */
export function discountVsMonthly(
  monthlyCents: number,
  totalCents: number,
  months: PackageDuration,
): number | null {
  if (!monthlyCents || !totalCents || months <= 1) return null;
  const reference = monthlyCents * months;
  if (reference <= totalCents) return null;
  return Math.round(((reference - totalCents) / reference) * 100);
}

/* ─── Formatos publicitários ─────────────────────────────────────────────── */

/**
 * Rótulos e dimensões espelhados de AdminAds.tsx, para o usuário não precisar
 * decorar chaves técnicas como "intermediario" ao definir a cota do pacote.
 */
export const AD_FORMAT_META: Record<
  AdFormat,
  { label: string; dims: string; desc: string }
> = {
  cover: {
    label: 'Capa TV (Topo)',
    dims: '1600 × 320 px',
    desc: 'Capa de canal — topo da rota /tv',
  },
  leaderboard: {
    label: 'Leaderboard',
    dims: '970 × 90 px',
    desc: 'Banner horizontal — topo das páginas',
  },
  intermediario: {
    label: 'Intermediário',
    dims: '728 × 90 px',
    desc: 'Banner intermediário — entre seções',
  },
  sidebar: {
    label: 'Sidebar',
    dims: '300 × 250 px',
    desc: 'Rectangle médio — lateral do conteúdo',
  },
  mobile: {
    label: 'Mobile',
    dims: '320 × 50 px',
    desc: 'Banner fixo — rodapé no celular',
  },
};

/* ─── Serviços ───────────────────────────────────────────────────────────── */

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  materia: 'Matéria',
  redes_sociais: 'Redes sociais',
  cobertura_evento: 'Cobertura de evento',
  programa: 'Participação em programa',
  video: 'Inserção em vídeo',
  banner_portal: 'Banner no portal',
  outro: 'Outro',
};

/* ─── Datas ──────────────────────────────────────────────────────────────── */

/** "2026-09-10" => "10/09/2026" (sem passar por Date, evitando fuso) */
export function formatBusinessDate(date: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
