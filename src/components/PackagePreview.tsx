import React, { useState } from 'react';
import { Check, Star, EyeOff, Package as PackageIcon } from 'lucide-react';
import {
  AD_FORMATS,
  PACKAGE_DURATIONS,
  type AdLimits,
  type PackageDuration,
  type PackagePrices,
  type ServiceType,
} from '../lib/commercial-types';
import {
  AD_FORMAT_META,
  SERVICE_TYPE_LABELS,
  discountVsMonthly,
  formatCents,
  formatDuration,
  formatMonthlyEquivalent,
} from '../lib/commercial-formatters';

/**
 * Pré-visualização do pacote.
 *
 * Consome exatamente o mesmo estado do formulário — não existe uma segunda
 * estrutura de dados. Assim o que o vendedor vê aqui é o que será gravado.
 *
 * mode 'interno'  → mostra status, destaque e formatos zerados (visão da equipe)
 * mode 'publico'  → mostra apenas o que o cliente pode ver
 */

export interface PackagePreviewData {
  name: string;
  description: string;
  color: string;
  isActive: boolean;
  isFeatured: boolean;
  prices: PackagePrices;
  adLimits: AdLimits;
}

export interface PreviewBenefit {
  label: string;
  isActive: boolean;
}

export interface PreviewContent {
  title: string;
  type: ServiceType;
  description: string;
  quantity: number | null;
  isActive: boolean;
}

interface PackagePreviewProps {
  data: PackagePreviewData;
  benefits: PreviewBenefit[];
  contents: PreviewContent[];
  mode?: 'interno' | 'publico';
  /** Período controlado externamente; se omitido, o preview controla o seu. */
  duration?: PackageDuration;
  onDurationChange?: (duration: PackageDuration) => void;
}

export const PackagePreview: React.FC<PackagePreviewProps> = ({
  data,
  benefits,
  contents,
  mode = 'interno',
  duration,
  onDurationChange,
}) => {
  const [innerDuration, setInnerDuration] = useState<PackageDuration>(12);
  const activeDuration = duration ?? innerDuration;

  const selectDuration = (d: PackageDuration) => {
    setInnerDuration(d);
    onDurationChange?.(d);
  };

  const isPublic = mode === 'publico';
  const priceCents = data.prices?.[activeDuration] ?? 0;
  const monthlyCents = data.prices?.[1] ?? 0;
  const discount = discountVsMonthly(monthlyCents, priceCents, activeDuration);

  // No modo público, itens desativados e formatos sem cota não aparecem
  const visibleBenefits = benefits.filter((b) => (isPublic ? b.isActive : true));
  const visibleContents = contents.filter((c) => (isPublic ? c.isActive : true));
  const visibleFormats = AD_FORMATS.filter(
    (f) => !isPublic || (data.adLimits?.[f] ?? 0) > 0,
  );

  const accent = /^#[0-9A-Fa-f]{6}$/.test(data.color) ? data.color : '#B87333';

  return (
    <div className="rounded-3xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      {/* Cabeçalho com a cor do pacote */}
      <div className="p-6 text-white relative" style={{ backgroundColor: accent }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-1">
              Pacote
            </p>
            <h3 className="text-2xl font-black tracking-tighter truncate">
              {data.name || 'Nome do pacote'}
            </h3>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {data.isFeatured && (
              <span className="flex items-center gap-1 bg-white/25 backdrop-blur-sm text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
                <Star size={10} fill="currentColor" /> Mais popular
              </span>
            )}
            {/* Status é informação interna — o cliente não precisa vê-la */}
            {!isPublic && !data.isActive && (
              <span className="flex items-center gap-1 bg-black/40 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
                <EyeOff size={10} /> Inativo
              </span>
            )}
          </div>
        </div>

        {data.description && (
          <p className="text-sm opacity-90 mt-3 leading-relaxed">{data.description}</p>
        )}
      </div>

      {/* Seletor de período */}
      <div className="px-6 pt-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
          Período de contratação
        </p>
        <div className="grid grid-cols-4 gap-2">
          {PACKAGE_DURATIONS.map((d) => {
            const selected = d === activeDuration;
            const value = data.prices?.[d] ?? 0;
            return (
              <button
                key={d}
                type="button"
                onClick={() => selectDuration(d)}
                className={`rounded-xl py-2 px-1 text-center transition-all border ${
                  selected
                    ? 'text-white border-transparent shadow-md'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
                style={selected ? { backgroundColor: accent } : undefined}
              >
                <span className="block text-xs font-black">{d}</span>
                <span className="block text-[9px] font-bold uppercase tracking-wider opacity-80">
                  {d === 1 ? 'mês' : 'meses'}
                </span>
                {/* Aviso interno: período sem preço não pode ser vendido */}
                {!isPublic && value === 0 && (
                  <span className="block text-[8px] font-bold mt-0.5 text-amber-600">
                    sem preço
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preço do período selecionado */}
      <div className="px-6 py-5">
        <div className="flex items-end gap-3 flex-wrap">
          <span className="text-4xl font-black tracking-tighter text-gray-900">
            {formatCents(priceCents)}
          </span>
          <span className="text-sm text-gray-400 font-bold pb-1">
            / {formatDuration(activeDuration)}
          </span>
          {discount !== null && (
            <span className="pb-1.5 text-[10px] font-black uppercase tracking-widest text-green-700 bg-green-100 px-2 py-1 rounded-full">
              Economize {discount}%
            </span>
          )}
        </div>
        {activeDuration > 1 && priceCents > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Equivale a {formatMonthlyEquivalent(priceCents, activeDuration)}
          </p>
        )}
        {priceCents === 0 && (
          <p className="text-xs text-amber-600 font-bold mt-1">
            Defina o preço deste período antes de publicar o pacote.
          </p>
        )}
      </div>

      {/* Benefícios */}
      <div className="px-6 pb-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
          Benefícios
        </p>
        {visibleBenefits.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nenhum benefício cadastrado.</p>
        ) : (
          <ul className="space-y-2">
            {visibleBenefits.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <Check size={15} className="shrink-0 mt-0.5" style={{ color: accent }} />
                <span className={!b.isActive ? 'line-through text-gray-400' : ''}>
                  {b.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Conteúdos e serviços */}
      <div className="px-6 pb-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
          Conteúdos e serviços
        </p>
        {visibleContents.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nenhum serviço cadastrado.</p>
        ) : (
          <ul className="space-y-2.5">
            {visibleContents.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <PackageIcon size={15} className="shrink-0 mt-0.5 text-gray-300" />
                <div className="min-w-0">
                  <p
                    className={`text-sm font-bold text-gray-800 ${
                      !c.isActive ? 'line-through text-gray-400' : ''
                    }`}
                  >
                    {c.quantity ? `${c.quantity}× ` : ''}
                    {c.title}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                    {SERVICE_TYPE_LABELS[c.type] ?? c.type}
                  </p>
                  {c.description && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      {c.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cota de anúncios */}
      <div className="px-6 pb-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
          Anúncios inclusos
        </p>
        {visibleFormats.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            Nenhum formato publicitário incluso neste pacote.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {visibleFormats.map((format) => {
                  const limit = data.adLimits?.[format] ?? 0;
                  return (
                    <tr key={format} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-2">
                        <span className="font-bold text-gray-800">
                          {AD_FORMAT_META[format].label}
                        </span>
                        <span className="block text-[10px] text-gray-400 font-mono">
                          {AD_FORMAT_META[format].dims}
                        </span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {limit > 0 ? (
                          <span
                            className="text-xs font-black px-2.5 py-1 rounded-full text-white"
                            style={{ backgroundColor: accent }}
                          >
                            {limit}
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-gray-300">
                            não incluso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
