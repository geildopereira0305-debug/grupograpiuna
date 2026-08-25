import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, getDocs, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, X, Search, Check, ChevronLeft, ChevronRight, Loader2, AlertTriangle,
  FileSignature, CheckCircle2, Users, Package as PackageIcon, CreditCard, ListChecks,
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import {
  AD_FORMATS, PACKAGE_DURATIONS, PAYMENT_METHODS,
  type ClientDocument, type ContractDocument, type PackageDocument,
  type PackageDuration, type PaymentMethod, type WithId,
} from '../lib/commercial-types';
import {
  AD_FORMAT_META, SERVICE_TYPE_LABELS, centsToInput, formatBusinessDate,
  formatCents, formatDuration, inputToCents,
} from '../lib/commercial-formatters';
import { buildInstallmentPlan, todayBusinessDate, addMonthsClamped } from '../lib/installment-dates';
import { closeContractSchema, formatZodErrors, onlyDigits } from '../lib/commercial-validation';
import { postCommercial, newIdempotencyKey, CommercialApiError } from '../lib/commercial-api';
import { can } from '../lib/permissions';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  outro: 'Outro',
};

const STEPS = [
  { n: 1, label: 'Cliente', icon: Users },
  { n: 2, label: 'Pacote e duração', icon: PackageIcon },
  { n: 3, label: 'Pagamento', icon: CreditCard },
  { n: 4, label: 'Limites e entregas', icon: ListChecks },
  { n: 5, label: 'Revisão', icon: FileSignature },
];

interface AdminContractsProps {
  /** Cliente pré-selecionado ao vir do botão "Novo contrato" da tela de clientes. */
  initialClient?: WithId<ClientDocument> | null;
  onConsumeInitialClient?: () => void;
}

export const AdminContracts: React.FC<AdminContractsProps> = ({
  initialClient,
  onConsumeInitialClient,
}) => {
  const { user, role } = useAuth();
  const canCreate = can(role, 'contracts.create');

  const [contracts, setContracts] = useState<WithId<ContractDocument>[]>([]);
  const [clients, setClients] = useState<WithId<ClientDocument>[]>([]);
  const [packages, setPackages] = useState<WithId<PackageDocument>[]>([]);
  const [loading, setLoading] = useState(true);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successId, setSuccessId] = useState<string | null>(null);

  // Etapa 1
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState('');
  // Etapa 2
  const [packageId, setPackageId] = useState('');
  const [duration, setDuration] = useState<PackageDuration>(12);
  const [snapshotPreview, setSnapshotPreview] = useState<{
    benefits: string[];
    contents: { title: string; type: string; description: string; quantity: number | null }[];
  }>({ benefits: [], contents: [] });
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  // Etapa 3
  const [installmentCount, setInstallmentCount] = useState(12);
  const [firstDueDate, setFirstDueDate] = useState(() => addMonthsClamped(todayBusinessDate(), 1));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [discountInput, setDiscountInput] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  /** Gerada uma vez por abertura do wizard: reenvios reutilizam a mesma chave. */
  const [idempotencyKey, setIdempotencyKey] = useState('');

  /* ── Carregamentos ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'contracts'), orderBy('createdAt', 'desc')),
      (snap) => {
        setContracts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<ContractDocument>)));
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'contracts');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<ClientDocument>))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'clients'),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'packages'),
      (snap) => setPackages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<PackageDocument>))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'packages'),
    );
    return () => unsub();
  }, []);

  /* ── Abertura vinda da tela de clientes ────────────────────────────────── */
  useEffect(() => {
    if (initialClient) {
      openWizard(initialClient.id);
      onConsumeInitialClient?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClient]);

  /* ── Snapshot preliminar do pacote escolhido ───────────────────────────── */
  useEffect(() => {
    if (!packageId) {
      setSnapshotPreview({ benefits: [], contents: [] });
      return;
    }
    let alive = true;
    setLoadingSnapshot(true);
    (async () => {
      try {
        const [b, c] = await Promise.all([
          getDocs(query(collection(db, 'packages', packageId, 'benefits'), orderBy('order', 'asc'))),
          getDocs(query(collection(db, 'packages', packageId, 'contents'), orderBy('order', 'asc'))),
        ]);
        if (!alive) return;
        setSnapshotPreview({
          benefits: b.docs.filter((d) => d.data().isActive !== false).map((d) => d.data().label ?? ''),
          contents: c.docs
            .filter((d) => d.data().isActive !== false)
            .map((d) => ({
              title: d.data().title ?? '',
              type: d.data().type ?? 'outro',
              description: d.data().description ?? '',
              quantity: d.data().quantity ?? null,
            })),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'packages/subcoleções');
      } finally {
        if (alive) setLoadingSnapshot(false);
      }
    })();
    return () => { alive = false; };
  }, [packageId]);

  /* ── Derivados ─────────────────────────────────────────────────────────── */
  const activeClients = useMemo(
    () => clients.filter((c) => c.status === 'active'),
    [clients],
  );

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    const digits = onlyDigits(clientSearch);
    if (!term) return activeClients;
    return activeClients.filter(
      (c) =>
        [c.legalName, c.tradeName, c.email].filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)) ||
        (digits.length >= 3 && String(c.documentNormalized ?? '').includes(digits)),
    );
  }, [activeClients, clientSearch]);

  const activePackages = useMemo(
    () => packages.filter((p) => p.isActive).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [packages],
  );

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])),
    [clients],
  );

  const selectedClient = clientMap[clientId] ?? null;
  const selectedPackage = packages.find((p) => p.id === packageId) ?? null;

  // O preço SEMPRE vem do documento do pacote — nunca de um campo digitado
  const subtotalCents = selectedPackage?.prices?.[duration] ?? 0;
  const discountCents = inputToCents(discountInput);
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const plan = useMemo(
    () => buildInstallmentPlan(totalCents, installmentCount, firstDueDate),
    [totalCents, installmentCount, firstDueDate],
  );

  /* ── Navegação do wizard ───────────────────────────────────────────────── */
  const openWizard = (preselectedClientId?: string) => {
    setStep(preselectedClientId ? 2 : 1);
    setClientId(preselectedClientId ?? '');
    setClientSearch('');
    setPackageId('');
    setDuration(12);
    setInstallmentCount(12);
    setFirstDueDate(addMonthsClamped(todayBusinessDate(), 1));
    setPaymentMethod('pix');
    setDiscountInput('');
    setDiscountReason('');
    setApiError(null);
    setFieldErrors({});
    setSuccessId(null);
    setIdempotencyKey(newIdempotencyKey('contract'));
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setSuccessId(null);
  };

  /** Regras mínimas para liberar o avanço de cada etapa. */
  const canAdvance = (): boolean => {
    if (step === 1) return !!clientId;
    if (step === 2) return !!packageId && subtotalCents > 0;
    if (step === 3) {
      return (
        installmentCount >= 1 && installmentCount <= 12 &&
        !!firstDueDate &&
        discountCents < subtotalCents &&
        (discountCents === 0 || discountReason.trim().length >= 3)
      );
    }
    return true;
  };

  /* ── Envio ─────────────────────────────────────────────────────────────── */
  const handleSubmit = async () => {
    setApiError(null);
    setFieldErrors({});

    const payload = {
      clientId,
      packageId,
      durationMonths: duration,
      installmentCount,
      firstDueDate,
      paymentMethod,
      sellerId: user?.uid ?? '',
      discountCents,
      discountReason: discountReason.trim(),
      idempotencyKey,
    };

    // Mesma validação que o servidor repetirá — evita ida desnecessária
    const parsed = closeContractSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(formatZodErrors(parsed.error));
      setApiError('Revise os dados destacados antes de fechar o contrato.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await postCommercial<{ contractId: string }>(
        '/api/commercial/close-contract',
        payload,
      );
      setSuccessId(result.contractId);
    } catch (err) {
      if (err instanceof CommercialApiError) {
        // 409 = a chave já foi processada; o contrato existe e não foi duplicado
        if (err.status === 409 && err.payload?.contractId) {
          setSuccessId(String(err.payload.contractId));
        } else {
          setApiError(err.message);
          if (err.fields) setFieldErrors(err.fields);
        }
      } else {
        setApiError('Erro inesperado ao fechar o contrato.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">
            Contratos <span className="text-red-600">Comerciais</span>
          </h1>
          <p className="text-gray-500 text-sm">
            {contracts.length} contrato{contracts.length !== 1 ? 's' : ''} registrado
            {contracts.length !== 1 ? 's' : ''}.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => openWizard()}
            className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-100"
          >
            <Plus size={20} /> NOVO CONTRATO
          </button>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : contracts.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-3xl">
          <FileSignature size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-bold">Nenhum contrato fechado ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const client = clientMap[contract.clientId];
            return (
              <div key={contract.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start gap-3 flex-wrap">
                  <div
                    className="w-10 h-10 rounded-xl shrink-0"
                    style={{ backgroundColor: contract.packageSnapshot?.color ?? '#B87333' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 truncate">
                        {client?.legalName ?? 'Cliente removido'}
                      </h3>
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {contract.packageSnapshot?.name}
                      </span>
                      <span
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                          contract.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : contract.status === 'cancelled'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {contract.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-gray-500">
                      <span>{formatDuration(contract.durationMonths)}</span>
                      <span className="font-bold text-gray-800">{formatCents(contract.totalCents)}</span>
                      <span>{contract.installmentCount}× parcelas</span>
                      <span>
                        {formatBusinessDate(contract.startDate)} → {formatBusinessDate(contract.endDate)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Wizard ──────────────────────────────────────────────────────── */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl my-8 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-black uppercase tracking-tighter">
                Novo <span className="text-red-600">Contrato</span>
              </h2>
              <button onClick={closeWizard} className="text-gray-400 hover:text-red-600">
                <X size={24} />
              </button>
            </div>

            {successId ? (
              /* ── Sucesso ─────────────────────────────────────────────── */
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-2xl font-black tracking-tighter mb-2">Contrato fechado!</h3>
                <p className="text-gray-500 text-sm mb-1">
                  {installmentCount} parcela{installmentCount !== 1 ? 's' : ''} de{' '}
                  {formatCents(plan[0]?.amountCents ?? 0)} gerada
                  {installmentCount !== 1 ? 's' : ''}, com snapshot do pacote preservado.
                </p>
                <p className="text-[11px] text-gray-400 font-mono mb-8">ID: {successId}</p>
                <button
                  onClick={closeWizard}
                  className="bg-red-600 text-white font-bold px-8 py-3 rounded-xl hover:bg-red-700 transition-colors"
                >
                  CONCLUIR
                </button>
              </div>
            ) : (
              <>
                {/* Trilha de etapas */}
                <div className="px-6 pt-5 pb-4 border-b border-gray-100 overflow-x-auto">
                  <div className="flex items-center gap-1 min-w-max">
                    {STEPS.map((s, i) => (
                      <React.Fragment key={s.n}>
                        <div
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
                            step === s.n
                              ? 'bg-red-600 text-white'
                              : step > s.n
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {step > s.n ? <Check size={12} /> : <s.icon size={12} />}
                          {s.label}
                        </div>
                        {i < STEPS.length - 1 && <div className="w-4 h-px bg-gray-200" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <div className="p-8 min-h-[320px]">
                  {/* ── 1. Cliente ─────────────────────────────────────── */}
                  {step === 1 && (
                    <div>
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-3 text-gray-400" size={17} />
                        <input
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Buscar cliente ativo por nome, CPF/CNPJ ou e-mail..."
                          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pl-10 text-sm focus:outline-none focus:border-red-600"
                        />
                      </div>
                      {filteredClients.length === 0 ? (
                        <div className="py-10 text-center text-gray-400 text-sm">
                          Nenhum cliente ativo encontrado. Cadastre o cliente na aba Clientes antes de
                          fechar o contrato.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {filteredClients.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setClientId(c.id)}
                              className={`w-full text-left p-3 rounded-xl border transition-all ${
                                clientId === c.id
                                  ? 'border-red-600 bg-red-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <p className="font-bold text-sm text-gray-900">{c.legalName}</p>
                              <p className="text-[11px] text-gray-500 font-mono">
                                {c.documentNumber} {c.email ? `· ${c.email}` : ''}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 2. Pacote e duração ────────────────────────────── */}
                  {step === 2 && (
                    <div>
                      {activePackages.length === 0 ? (
                        <div className="py-10 text-center text-gray-400 text-sm">
                          Nenhum pacote ativo. Ative um pacote na aba Pacotes.
                        </div>
                      ) : (
                        <>
                          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                            Pacote
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            {activePackages.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => setPackageId(p.id)}
                                className={`p-3 rounded-xl border text-left transition-all ${
                                  packageId === p.id
                                    ? 'border-red-600 shadow-md'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                <div
                                  className="w-full h-1.5 rounded-full mb-2"
                                  style={{ backgroundColor: p.color ?? '#B87333' }}
                                />
                                <span className="font-black text-sm text-gray-900 block truncate">
                                  {p.name}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {p.prices?.[duration] ? formatCents(p.prices[duration]) : 'sem preço'}
                                </span>
                              </button>
                            ))}
                          </div>

                          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                            Duração
                          </p>
                          <div className="grid grid-cols-4 gap-3">
                            {PACKAGE_DURATIONS.map((d) => {
                              const price = selectedPackage?.prices?.[d] ?? 0;
                              const disabled = !!selectedPackage && price <= 0;
                              return (
                                <button
                                  key={d}
                                  disabled={disabled}
                                  onClick={() => {
                                    setDuration(d);
                                    setInstallmentCount(d);
                                  }}
                                  className={`p-3 rounded-xl border text-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                    duration === d ? 'border-red-600 bg-red-50' : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <span className="block font-black text-gray-900">{d}</span>
                                  <span className="block text-[10px] text-gray-400 uppercase font-bold">
                                    {d === 1 ? 'mês' : 'meses'}
                                  </span>
                                  <span className="block text-[10px] font-bold text-gray-600 mt-1">
                                    {price ? formatCents(price) : '—'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {selectedPackage && subtotalCents <= 0 && (
                            <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-xs p-3 rounded-xl mt-4">
                              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                              Este pacote não tem preço para {formatDuration(duration)}. Escolha outro
                              período ou cadastre o preço na aba Pacotes.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* ── 3. Condições de pagamento ──────────────────────── */}
                  {step === 3 && (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                            Nº de parcelas
                          </label>
                          <select
                            value={installmentCount}
                            onChange={(e) => setInstallmentCount(Number(e.target.value))}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-red-600"
                          >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>{n}×</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                            1º vencimento
                          </label>
                          <input
                            type="date"
                            value={firstDueDate}
                            onChange={(e) => setFirstDueDate(e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                          />
                          {fieldErrors.firstDueDate && (
                            <p className="text-[11px] text-red-600 mt-1">{fieldErrors.firstDueDate}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                            Forma de pagamento
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-red-600"
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                            Desconto (R$)
                          </label>
                          <input
                            inputMode="decimal"
                            placeholder="0,00"
                            value={discountInput}
                            onChange={(e) => setDiscountInput(e.target.value)}
                            onBlur={(e) =>
                              setDiscountInput(e.target.value ? centsToInput(inputToCents(e.target.value)) : '')
                            }
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                            Motivo do desconto {discountCents > 0 && <span className="text-red-600">*</span>}
                          </label>
                          <input
                            value={discountReason}
                            onChange={(e) => setDiscountReason(e.target.value)}
                            disabled={discountCents === 0}
                            placeholder={discountCents === 0 ? 'Informe um desconto para habilitar' : 'Ex: campanha de fim de ano'}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600 disabled:bg-gray-50"
                          />
                          {fieldErrors.discountReason && (
                            <p className="text-[11px] text-red-600 mt-1">{fieldErrors.discountReason}</p>
                          )}
                        </div>
                      </div>

                      {discountCents >= subtotalCents && discountCents > 0 && (
                        <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs p-3 rounded-xl">
                          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                          O desconto não pode ser igual ou maior que o valor do pacote.
                        </div>
                      )}

                      {/* Prévia das parcelas — mesma função usada pelo servidor */}
                      <div className="bg-gray-50 rounded-2xl p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                          Parcelas geradas
                        </p>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {plan.map((p) => (
                            <div key={p.number} className="flex justify-between text-xs">
                              <span className="text-gray-500">
                                {p.number}ª — {formatBusinessDate(p.dueDate)}
                              </span>
                              <span className="font-bold text-gray-800">{formatCents(p.amountCents)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-sm font-black mt-3 pt-2 border-t border-gray-200">
                          <span>Total</span>
                          <span>{formatCents(totalCents)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── 4. Limites e entregas ──────────────────────────── */}
                  {step === 4 && (
                    <div className="space-y-6">
                      <div className="flex items-start gap-2 bg-blue-50 text-blue-800 text-[11px] p-3 rounded-xl">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        Este conteúdo será congelado no contrato como <strong>packageSnapshot</strong>.
                        Alterações futuras no pacote não afetarão este contrato.
                      </div>

                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                          Cota de anúncios
                        </p>
                        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                          {AD_FORMATS.map((f) => {
                            const limit = selectedPackage?.adLimits?.[f] ?? 0;
                            return (
                              <div key={f} className="flex items-center justify-between p-2.5">
                                <div>
                                  <span className="text-sm font-bold text-gray-800">
                                    {AD_FORMAT_META[f].label}
                                  </span>
                                  <span className="block text-[10px] text-gray-400 font-mono">
                                    {AD_FORMAT_META[f].dims}
                                  </span>
                                </div>
                                <span className={`text-sm font-black ${limit > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                                  {limit}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {loadingSnapshot ? (
                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                          <Loader2 size={15} className="animate-spin" /> Carregando benefícios...
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                              Benefícios ({snapshotPreview.benefits.length})
                            </p>
                            {snapshotPreview.benefits.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">Nenhum.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {snapshotPreview.benefits.map((b, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                                    <Check size={13} className="text-green-600 shrink-0 mt-0.5" /> {b}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                              Conteúdos ({snapshotPreview.contents.length})
                            </p>
                            {snapshotPreview.contents.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">Nenhum.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {snapshotPreview.contents.map((c, i) => (
                                  <li key={i} className="text-xs text-gray-700">
                                    <span className="font-bold">
                                      {c.quantity ? `${c.quantity}× ` : ''}{c.title}
                                    </span>
                                    <span className="block text-[10px] text-gray-400 uppercase tracking-wider">
                                      {SERVICE_TYPE_LABELS[c.type] ?? c.type}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 5. Revisão ─────────────────────────────────────── */}
                  {step === 5 && (
                    <div className="space-y-4">
                      {apiError && (
                        <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs p-3 rounded-xl">
                          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {apiError}
                        </div>
                      )}

                      <dl className="divide-y divide-gray-100 border border-gray-100 rounded-2xl overflow-hidden">
                        {[
                          ['Cliente', `${selectedClient?.legalName ?? '—'}${selectedClient?.contactName ? ` · ${selectedClient.contactName}` : ''}`],
                          ['Pacote', selectedPackage?.name ?? '—'],
                          ['Duração', formatDuration(duration)],
                          ['Valor de tabela', formatCents(subtotalCents)],
                          ...(discountCents > 0
                            ? [[`Desconto (${discountReason})`, `− ${formatCents(discountCents)}`] as [string, string]]
                            : []),
                          ['Total', formatCents(totalCents)],
                          ['Parcelas', `${installmentCount}× de ${formatCents(plan[0]?.amountCents ?? 0)}`],
                          ['1º vencimento', formatBusinessDate(firstDueDate)],
                          ['Forma de pagamento', PAYMENT_LABELS[paymentMethod]],
                          ['Limites', AD_FORMATS.filter((f) => (selectedPackage?.adLimits?.[f] ?? 0) > 0)
                            .map((f) => `${selectedPackage?.adLimits?.[f]} ${AD_FORMAT_META[f].label}`)
                            .join(', ') || 'Nenhum formato incluso'],
                          ['Benefícios', `${snapshotPreview.benefits.length} item(ns) no snapshot`],
                          ['Conteúdos', `${snapshotPreview.contents.length} serviço(s) no snapshot`],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                            <dt className="text-xs font-bold uppercase tracking-wider text-gray-400 shrink-0">
                              {label}
                            </dt>
                            <dd className="text-sm font-bold text-gray-900 text-right">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      <p className="text-[11px] text-gray-400">
                        O preço vem do cadastro do pacote e é confirmado novamente no servidor.
                        Contrato, parcelas e cotas são gravados numa única transação.
                      </p>
                    </div>
                  )}
                </div>

                {/* Navegação */}
                <div className="p-6 border-t border-gray-100 flex justify-between gap-3 bg-gray-50">
                  <button
                    onClick={() => (step === 1 ? closeWizard() : setStep(step - 1))}
                    disabled={submitting}
                    className="px-5 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <ChevronLeft size={16} /> {step === 1 ? 'Cancelar' : 'Voltar'}
                  </button>

                  {step < 5 ? (
                    <button
                      onClick={() => setStep(step + 1)}
                      disabled={!canAdvance()}
                      className="px-6 py-3 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Avançar <ChevronRight size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="px-6 py-3 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-60"
                    >
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <FileSignature size={16} />}
                      {submitting ? 'FECHANDO...' : 'FECHAR CONTRATO'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
