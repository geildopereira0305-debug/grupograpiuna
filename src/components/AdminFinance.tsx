import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import {
  X, Search, Loader2, AlertTriangle, CheckCircle2, Wallet, Clock,
  CircleSlash, TrendingUp, Ban, Receipt,
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import type {
  ClientDocument, ContractDocument, InstallmentDocument, PaymentMethod, WithId,
} from '../lib/commercial-types';
import { PAYMENT_METHODS } from '../lib/commercial-types';
import {
  centsToInput, formatBusinessDate, formatCents, inputToCents,
} from '../lib/commercial-formatters';
import { todayBusinessDate } from '../lib/installment-dates';
import { registerPaymentSchema, formatZodErrors } from '../lib/commercial-validation';
import { postCommercial, newIdempotencyKey, CommercialApiError } from '../lib/commercial-api';
import { can } from '../lib/permissions';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX', boleto: 'Boleto', cartao: 'Cartão',
  dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro',
};

/** Situação exibida — 'overdue' é derivada da data, não do campo gravado. */
type ViewStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

const VIEWS: { key: ViewStatus; label: string; icon: React.ElementType; tone: string }[] = [
  { key: 'pending', label: 'Pendentes', icon: Clock, tone: 'text-amber-600 bg-amber-50' },
  { key: 'overdue', label: 'Atrasados', icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
  { key: 'paid', label: 'Pagos', icon: CheckCircle2, tone: 'text-green-600 bg-green-50' },
  { key: 'cancelled', label: 'Cancelados', icon: CircleSlash, tone: 'text-gray-500 bg-gray-100' },
];

export const AdminFinance = () => {
  const { role } = useAuth();
  const canWrite = can(role, 'finance.write');
  const today = todayBusinessDate();

  const [installments, setInstallments] = useState<WithId<InstallmentDocument>[]>([]);
  const [clients, setClients] = useState<WithId<ClientDocument>[]>([]);
  const [contracts, setContracts] = useState<WithId<ContractDocument>[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewStatus>('pending');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [packageFilter, setPackageFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Modal de baixa
  const [target, setTarget] = useState<WithId<InstallmentDocument> | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* ── Carregamentos ─────────────────────────────────────────────────────── */
  useEffect(() => {
    // orderBy simples: não exige índice composto. O recorte por status e
    // período é feito na memória, porque a tela combina vários filtros.
    const unsub = onSnapshot(
      query(collection(db, 'installments'), orderBy('dueDate', 'asc')),
      (snap) => {
        setInstallments(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<InstallmentDocument>)),
        );
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'installments');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubClients = onSnapshot(
      collection(db, 'clients'),
      (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<ClientDocument>))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'clients'),
    );
    const unsubContracts = onSnapshot(
      collection(db, 'contracts'),
      (snap) => setContracts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<ContractDocument>))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'contracts'),
    );
    return () => { unsubClients(); unsubContracts(); };
  }, []);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])),
    [clients],
  );
  const contractMap = useMemo(
    () => Object.fromEntries(contracts.map((c) => [c.id, c])),
    [contracts],
  );

  /** Nomes de pacote vendidos, extraídos do snapshot de cada contrato. */
  const packageNames = useMemo(
    () => [...new Set(contracts.map((c) => c.packageSnapshot?.name).filter(Boolean))].sort(),
    [contracts],
  );

  /**
   * Situação real da parcela. Atrasada = não paga e com vencimento anterior a
   * hoje no fuso de negócio — o campo gravado pode estar como 'pending' porque
   * ninguém reprocessa o banco à meia-noite.
   */
  const statusOf = (inst: InstallmentDocument): ViewStatus => {
    if (inst.status === 'cancelled') return 'cancelled';
    if (inst.status === 'paid') return 'paid';
    return inst.dueDate < today ? 'overdue' : 'pending';
  };

  /* ── Filtros ───────────────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return installments.filter((inst) => {
      if (statusOf(inst) !== view) return false;
      if (clientFilter && inst.clientId !== clientFilter) return false;
      if (fromDate && inst.dueDate < fromDate) return false;
      if (toDate && inst.dueDate > toDate) return false;

      const contract = contractMap[inst.contractId];
      if (packageFilter && contract?.packageSnapshot?.name !== packageFilter) return false;

      if (term) {
        const client = clientMap[inst.clientId];
        const haystack = [client?.legalName, client?.tradeName, contract?.packageSnapshot?.name]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installments, view, clientFilter, packageFilter, fromDate, toDate, search, contractMap, clientMap, today]);

  /* ── Totais por visão (sempre sobre a base completa) ───────────────────── */
  const totals = useMemo(() => {
    const acc: Record<ViewStatus, { count: number; cents: number }> = {
      pending: { count: 0, cents: 0 },
      overdue: { count: 0, cents: 0 },
      paid: { count: 0, cents: 0 },
      cancelled: { count: 0, cents: 0 },
    };
    for (const inst of installments) {
      const s = statusOf(inst);
      acc[s].count += 1;
      // Em aberto conta o saldo; pago conta o que entrou
      acc[s].cents += s === 'paid'
        ? (inst.paidCents ?? 0)
        : (inst.amountCents ?? 0) - (inst.paidCents ?? 0);
    }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installments, today]);

  /* ── Baixa ─────────────────────────────────────────────────────────────── */
  const openPayment = (inst: WithId<InstallmentDocument>) => {
    const remaining = (inst.amountCents ?? 0) - (inst.paidCents ?? 0);
    setTarget(inst);
    setAmountInput(centsToInput(remaining));
    setPaidAt(today);
    setMethod((inst.paymentMethod as PaymentMethod) ?? 'pix');
    setReference('');
    setNotes('');
    setIdempotencyKey(newIdempotencyKey('payment'));
    setApiError(null);
    setFieldErrors({});
    setSuccessMsg(null);
  };

  const closePayment = () => {
    setTarget(null);
    setSuccessMsg(null);
  };

  const handleRegisterPayment = async () => {
    if (!target) return;
    setApiError(null);
    setFieldErrors({});

    const payload = {
      installmentId: target.id,
      amountCents: inputToCents(amountInput),
      paidAt,
      method,
      reference: reference.trim(),
      notes: notes.trim(),
      idempotencyKey,
    };

    const parsed = registerPaymentSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(formatZodErrors(parsed.error));
      setApiError('Revise os dados destacados.');
      return;
    }

    const remaining = (target.amountCents ?? 0) - (target.paidCents ?? 0);
    if (payload.amountCents > remaining) {
      setApiError(`Valor acima do saldo em aberto (${formatCents(remaining)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await postCommercial<{ status: string; remainingCents: number }>(
        '/api/commercial/register-payment',
        payload,
      );
      setSuccessMsg(
        result.remainingCents > 0
          ? `Baixa parcial registrada. Restam ${formatCents(result.remainingCents)}.`
          : 'Parcela quitada.',
      );
    } catch (err) {
      if (err instanceof CommercialApiError) {
        // 409 = chave já processada; a baixa existe e não foi duplicada
        if (err.status === 409) setSuccessMsg('Esta baixa já havia sido registrada.');
        else {
          setApiError(err.message);
          if (err.fields) setFieldErrors(err.fields);
        }
      } else {
        setApiError('Erro inesperado ao registrar a baixa.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const targetRemaining = target ? (target.amountCents ?? 0) - (target.paidCents ?? 0) : 0;

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-black uppercase tracking-tighter">
          Financeiro <span className="text-red-600">Comercial</span>
        </h1>
        <p className="text-gray-500 text-sm">
          {installments.length} parcela{installments.length !== 1 ? 's' : ''} no total. Atrasos
          calculados no fuso de negócio ({today.split('-').reverse().join('/')}).
        </p>
      </div>

      {/* Cartões de totais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`text-left p-4 rounded-2xl border transition-all ${
              view === v.key ? 'border-red-600 shadow-md bg-white' : 'border-gray-100 bg-white hover:border-gray-300'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${v.tone}`}>
              <v.icon size={16} />
            </div>
            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
              {v.label}
            </span>
            <span className="block text-xl font-black tracking-tighter text-gray-900">
              {formatCents(totals[v.key].cents)}
            </span>
            <span className="block text-[11px] text-gray-400">
              {totals[v.key].count} parcela{totals[v.key].count !== 1 ? 's' : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente ou pacote..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2 pl-9 text-sm focus:outline-none focus:border-red-600"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-600"
          >
            <option value="">Todos os clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
          </select>
          <select
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-600"
          >
            <option value="">Todos os pacotes</option>
            {packageNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            title="Vencimento a partir de"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-600"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            title="Vencimento até"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-600"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-3xl">
          <Wallet size={30} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-bold">
            Nenhuma parcela {VIEWS.find((v) => v.key === view)?.label.toLowerCase()} com estes filtros.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inst) => {
            const client = clientMap[inst.clientId];
            const contract = contractMap[inst.contractId];
            const status = statusOf(inst);
            const remaining = (inst.amountCents ?? 0) - (inst.paidCents ?? 0);
            const partial = (inst.paidCents ?? 0) > 0 && status !== 'paid';
            return (
              <div
                key={inst.id}
                className={`bg-white border rounded-xl p-3 flex items-center gap-3 flex-wrap ${
                  status === 'overdue' ? 'border-red-200' : 'border-gray-100'
                }`}
              >
                <div className="w-11 shrink-0 text-center">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                    Parc.
                  </span>
                  <span className="block text-sm font-black text-gray-900">{inst.number}</span>
                </div>

                <div className="flex-1 min-w-[160px]">
                  <p className="font-bold text-sm text-gray-900 truncate">
                    {client?.legalName ?? 'Cliente removido'}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {contract?.packageSnapshot?.name ?? '—'} · vence {formatBusinessDate(inst.dueDate)}
                    {partial && ` · ${formatCents(inst.paidCents ?? 0)} já pago`}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="block text-sm font-black text-gray-900">
                    {formatCents(inst.amountCents ?? 0)}
                  </span>
                  {partial && (
                    <span className="block text-[11px] text-amber-600 font-bold">
                      resta {formatCents(remaining)}
                    </span>
                  )}
                </div>

                <span
                  className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full shrink-0 ${
                    VIEWS.find((v) => v.key === status)?.tone
                  }`}
                >
                  {VIEWS.find((v) => v.key === status)?.label.replace(/s$/, '')}
                </span>

                {canWrite && status !== 'paid' && status !== 'cancelled' && (
                  <button
                    onClick={() => openPayment(inst)}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  >
                    <Receipt size={12} /> Dar baixa
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de baixa */}
      {target && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl my-8 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-black uppercase tracking-tighter">
                Registrar <span className="text-red-600">Baixa</span>
              </h2>
              <button onClick={closePayment} className="text-gray-400 hover:text-red-600">
                <X size={24} />
              </button>
            </div>

            {successMsg ? (
              <div className="p-10 text-center">
                <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={28} />
                </div>
                <p className="font-bold text-gray-900 mb-6">{successMsg}</p>
                <button
                  onClick={closePayment}
                  className="bg-red-600 text-white font-bold px-8 py-3 rounded-xl hover:bg-red-700 transition-colors"
                >
                  CONCLUIR
                </button>
              </div>
            ) : (
              <div className="p-8 space-y-4">
                <div className="bg-gray-50 rounded-2xl p-4 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-500">Cliente</span>
                    <span className="font-bold">{clientMap[target.clientId]?.legalName ?? '—'}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-500">Parcela {target.number} · vence</span>
                    <span className="font-bold">{formatBusinessDate(target.dueDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Saldo em aberto</span>
                    <span className="font-black text-gray-900">{formatCents(targetRemaining)}</span>
                  </div>
                </div>

                {apiError && (
                  <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs p-3 rounded-xl">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {apiError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                      Valor recebido (R$)
                    </label>
                    <input
                      inputMode="decimal"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      onBlur={(e) =>
                        setAmountInput(e.target.value ? centsToInput(inputToCents(e.target.value)) : '')
                      }
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-red-600"
                    />
                    {fieldErrors.amountCents && (
                      <p className="text-[11px] text-red-600 mt-1">{fieldErrors.amountCents}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                      Data do pagamento
                    </label>
                    <input
                      type="date"
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                    />
                    {fieldErrors.paidAt && (
                      <p className="text-[11px] text-red-600 mt-1">{fieldErrors.paidAt}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Forma</label>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-red-600"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                      Referência
                    </label>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Nº do boleto, id do PIX..."
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                    Observação
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-red-600"
                  />
                </div>

                {inputToCents(amountInput) > 0 && inputToCents(amountInput) < targetRemaining && (
                  <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-[11px] p-3 rounded-xl">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    Baixa parcial: a parcela continuará em aberto com saldo de{' '}
                    {formatCents(targetRemaining - inputToCents(amountInput))}.
                  </div>
                )}

                <div className="flex items-start gap-2 bg-blue-50 text-blue-800 text-[11px] p-3 rounded-xl">
                  <Ban size={14} className="shrink-0 mt-0.5" />
                  Baixa registrada não pode ser editada. Para corrigir, registre um estorno
                  auditado — o histórico original é preservado.
                </div>

                <div className="flex gap-4 pt-1">
                  <button
                    onClick={closePayment}
                    disabled={submitting}
                    className="flex-1 bg-gray-100 text-gray-500 font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={handleRegisterPayment}
                    disabled={submitting || inputToCents(amountInput) <= 0}
                    className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />}
                    {submitting ? 'REGISTRANDO...' : 'CONFIRMAR BAIXA'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
