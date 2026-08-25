import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, doc, getDocs, onSnapshot, query, where, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, Search, Edit2, X, Users, Building2, Mail, Phone, FileText,
  AlertTriangle, Loader2, CheckCircle2, Ban,
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import type { ClientDocument, WithId } from '../lib/commercial-types';
import { clientSchema, formatZodErrors, onlyDigits } from '../lib/commercial-validation';
import { formatCents } from '../lib/commercial-formatters';
import { can } from '../lib/permissions';

/* ─── Formatação de documento ────────────────────────────────────────────── */

const formatDocument = (value: string, type: 'cpf' | 'cnpj'): string => {
  const d = onlyDigits(value);
  if (type === 'cpf') {
    return d
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

const EMPTY_FORM = {
  legalName: '',
  tradeName: '',
  documentType: 'cnpj' as 'cpf' | 'cnpj',
  documentNumber: '',
  email: '',
  phone: '',
  whatsapp: '',
  contactName: '',
  notes: '',
  status: 'active' as 'active' | 'inactive',
  address: {
    street: '', number: '', complement: '', neighborhood: '',
    city: '', state: '', zipCode: '',
  },
};

/** Resumo derivado — vive fora do documento do cliente, como pede o guia. */
interface ClientSummary {
  activeContracts: number;
  pendingCents: number;
  allocatedAds: number;
  /** Falta de permissão em installments/client_ads não é erro: só omite o dado. */
  financeDenied: boolean;
}

interface AdminClientsProps {
  /** Quando informado, o card do cliente ganha o botão "Novo contrato". */
  onStartContract?: (client: WithId<ClientDocument>) => void;
}

export const AdminClients: React.FC<AdminClientsProps> = ({ onStartContract }) => {
  const { user, role } = useAuth();
  const canWrite = can(role, 'clients.write');

  const [clients, setClients] = useState<WithId<ClientDocument>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  /* ── Lista ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<ClientDocument>)));
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'clients');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  /* ── Busca por razão social, fantasia, documento, e-mail e telefone ────── */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = onlyDigits(search);
    const list = [...clients].sort((a, b) =>
      (a.legalName ?? '').localeCompare(b.legalName ?? '', 'pt-BR'),
    );
    if (!term) return list;
    return list.filter((c) =>
      [c.legalName, c.tradeName, c.email, c.contactName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)) ||
      (digits.length >= 3 &&
        [c.documentNormalized, onlyDigits(c.phone ?? ''), onlyDigits(c.whatsapp ?? '')]
          .filter(Boolean)
          .some((v) => String(v).includes(digits))),
    );
  }, [clients, search]);

  /* ── Resumo do cliente selecionado ─────────────────────────────────────── */
  useEffect(() => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    let alive = true;
    setLoadingSummary(true);

    (async () => {
      let activeContracts = 0;
      let pendingCents = 0;
      let allocatedAds = 0;
      let financeDenied = false;

      try {
        const contractsSnap = await getDocs(
          query(collection(db, 'contracts'), where('clientId', '==', selectedId)),
        );
        activeContracts = contractsSnap.docs.filter((d) => d.data().status === 'active').length;
      } catch {
        // coleção ainda vazia ou sem permissão — segue com zero
      }

      try {
        const installmentsSnap = await getDocs(
          query(collection(db, 'installments'), where('clientId', '==', selectedId)),
        );
        pendingCents = installmentsSnap.docs
          .filter((d) => ['pending', 'overdue'].includes(d.data().status))
          .reduce((acc, d) => acc + (d.data().amountCents ?? 0) - (d.data().paidCents ?? 0), 0);
      } catch {
        // Operador de anúncios não lê financeiro — omite em vez de quebrar a tela
        financeDenied = true;
      }

      try {
        const adsSnap = await getDocs(
          query(collection(db, 'client_ads'), where('clientId', '==', selectedId)),
        );
        allocatedAds = adsSnap.docs.filter((d) =>
          ['approved', 'published'].includes(d.data().status),
        ).length;
      } catch {
        // idem para quem não opera anúncios
      }

      if (alive) {
        setSummary({ activeContracts, pendingCents, allocatedAds, financeDenied });
        setLoadingSummary(false);
      }
    })();

    return () => { alive = false; };
  }, [selectedId]);

  /* ── Formulário ────────────────────────────────────────────────────────── */
  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEdit = (client: WithId<ClientDocument>) => {
    setForm({
      legalName: client.legalName ?? '',
      tradeName: client.tradeName ?? '',
      documentType: (client.documentType ?? 'cnpj') as 'cpf' | 'cnpj',
      documentNumber: client.documentNumber ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      whatsapp: client.whatsapp ?? '',
      contactName: client.contactName ?? '',
      notes: client.notes ?? '',
      status: (client.status ?? 'active') as 'active' | 'inactive',
      address: { ...EMPTY_FORM.address, ...(client.address ?? {}) },
    });
    setErrors({});
    setEditingId(client.id);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = clientSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(formatZodErrors(parsed.error));
      return;
    }

    const normalized = onlyDigits(parsed.data.documentNumber);
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const clientRef = editingId
        ? doc(db, 'clients', editingId)
        : doc(collection(db, 'clients'));
      const uid = user?.uid ?? 'desconhecido';

      batch.set(
        clientRef,
        {
          ...parsed.data,
          documentNormalized: normalized,
          emailNormalized: parsed.data.email,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          ...(editingId ? {} : { createdAt: serverTimestamp(), createdBy: uid }),
        },
        { merge: true },
      );

      // Índice de unicidade: só é criado no cadastro. Como as regras permitem
      // create mas não update, um documento já existente derruba o lote inteiro
      // — é assim que o CPF/CNPJ duplicado é bloqueado mesmo com duas abas.
      if (!editingId) {
        batch.set(doc(db, 'client_identifiers', normalized), {
          clientId: clientRef.id,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      closeModal();
    } catch (err: any) {
      if (err?.code === 'permission-denied' && !editingId) {
        setErrors({ documentNumber: 'Já existe um cliente com este CPF/CNPJ.' });
      } else {
        handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'clients');
      }
    } finally {
      setSaving(false);
    }
  };

  const selected = clients.find((c) => c.id === selectedId) ?? null;

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">
            Clientes <span className="text-red-600">Comerciais</span>
          </h1>
          <p className="text-gray-500 text-sm">
            {clients.length} cliente{clients.length !== 1 ? 's' : ''} cadastrado
            {clients.length !== 1 ? 's' : ''}.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openCreate}
            className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-100"
          >
            <Plus size={20} /> NOVO CLIENTE
          </button>
        )}
      </div>

      {/* Busca */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-3.5 text-gray-400" size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por razão social, nome fantasia, CPF/CNPJ, e-mail ou telefone..."
          className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 pl-10 text-sm focus:outline-none focus:border-red-600"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-3xl">
          <Users size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-bold">
            {search ? 'Nenhum cliente encontrado para esta busca.' : 'Nenhum cliente cadastrado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((client) => {
            const isOpen = selectedId === client.id;
            return (
              <div
                key={client.id}
                className={`bg-white border rounded-2xl transition-all ${
                  isOpen ? 'border-red-200 shadow-md' : 'border-gray-100 shadow-sm hover:shadow-md'
                }`}
              >
                <button
                  onClick={() => setSelectedId(isOpen ? null : client.id)}
                  className="w-full text-left p-4 flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-400">
                    {client.documentType === 'cpf' ? <Users size={18} /> : <Building2 size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 truncate">{client.legalName}</h3>
                      <span
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                          client.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {client.status === 'active' ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    {client.tradeName && (
                      <p className="text-xs text-gray-500 truncate">{client.tradeName}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1 font-mono">
                        <FileText size={11} /> {client.documentNumber}
                      </span>
                      {client.email && (
                        <span className="flex items-center gap-1"><Mail size={11} /> {client.email}</span>
                      )}
                      {client.phone && (
                        <span className="flex items-center gap-1"><Phone size={11} /> {client.phone}</span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Painel de dados derivados */}
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                    {loadingSummary ? (
                      <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 size={15} className="animate-spin" /> Carregando resumo...
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          <div className="bg-gray-50 rounded-xl p-3">
                            <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                              Contratos ativos
                            </span>
                            <span className="text-lg font-black text-gray-900">
                              {summary?.activeContracts ?? 0}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                              Saldo pendente
                            </span>
                            <span className="text-lg font-black text-gray-900">
                              {summary?.financeDenied ? '—' : formatCents(summary?.pendingCents ?? 0)}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                              Anúncios alocados
                            </span>
                            <span className="text-lg font-black text-gray-900">
                              {summary?.allocatedAds ?? 0}
                            </span>
                          </div>
                        </div>

                        {client.address?.city && (
                          <p className="text-xs text-gray-500 mb-3">
                            {client.address.street}
                            {client.address.number ? `, ${client.address.number}` : ''} —{' '}
                            {client.address.neighborhood}, {client.address.city}/{client.address.state}
                          </p>
                        )}
                        {client.notes && (
                          <p className="text-xs text-gray-500 italic mb-3">{client.notes}</p>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          {canWrite && (
                            <button
                              onClick={() => openEdit(client)}
                              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                            >
                              <Edit2 size={12} /> Editar
                            </button>
                          )}
                          {onStartContract && client.status === 'active' && (
                            <button
                              onClick={() => onStartContract(client)}
                              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                            >
                              <Plus size={12} /> Novo contrato
                            </button>
                          )}
                          {client.status !== 'active' && (
                            <span className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-lg">
                              <Ban size={12} /> Cliente inativo não fecha contrato
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl my-8 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-black uppercase tracking-tighter">
                {editingId ? 'Editar' : 'Novo'} <span className="text-red-600">Cliente</span>
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-red-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                    Razão social / Nome
                  </label>
                  <input
                    value={form.legalName}
                    onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                  {errors.legalName && <p className="text-[11px] text-red-600 mt-1">{errors.legalName}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                    Nome fantasia
                  </label>
                  <input
                    value={form.tradeName}
                    onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Tipo</label>
                  <select
                    value={form.documentType}
                    disabled={!!editingId}
                    onChange={(e) =>
                      setForm({ ...form, documentType: e.target.value as 'cpf' | 'cnpj', documentNumber: '' })
                    }
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-red-600 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="cnpj">CNPJ</option>
                    <option value="cpf">CPF</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                    {form.documentType === 'cpf' ? 'CPF' : 'CNPJ'}
                  </label>
                  <input
                    value={form.documentNumber}
                    disabled={!!editingId}
                    onChange={(e) =>
                      setForm({ ...form, documentNumber: formatDocument(e.target.value, form.documentType) })
                    }
                    placeholder={form.documentType === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 font-mono focus:outline-none focus:border-red-600 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  {errors.documentNumber && (
                    <p className="text-[11px] text-red-600 mt-1">{errors.documentNumber}</p>
                  )}
                  {editingId && (
                    // Alterar o documento exigiria liberar a chave antiga em
                    // client_identifiers, operação restrita ao administrador.
                    <p className="text-[10px] text-gray-400 mt-1">
                      O documento não pode ser alterado após o cadastro.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">E-mail</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                  {errors.email && <p className="text-[11px] text-red-600 mt-1">{errors.email}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Telefone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">WhatsApp</label>
                  <input
                    value={form.whatsapp}
                    onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                    Contato responsável
                  </label>
                  <input
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-red-600"
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>

              {/* Endereço */}
              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Endereço</label>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <input
                    placeholder="Rua"
                    value={form.address.street}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
                    className="sm:col-span-3 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="Nº"
                    value={form.address.number}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, number: e.target.value } })}
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="Compl."
                    value={form.address.complement}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, complement: e.target.value } })}
                    className="sm:col-span-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="Bairro"
                    value={form.address.neighborhood}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, neighborhood: e.target.value } })}
                    className="sm:col-span-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="Cidade"
                    value={form.address.city}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                    className="sm:col-span-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="UF"
                    maxLength={2}
                    value={form.address.state}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value.toUpperCase() } })}
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:outline-none focus:border-red-600"
                  />
                  <input
                    placeholder="CEP"
                    value={form.address.zipCode}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, zipCode: e.target.value } })}
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-600"
                  />
                </div>
                {errors['address.state'] && (
                  <p className="text-[11px] text-red-600 mt-1">{errors['address.state']}</p>
                )}
                {errors['address.zipCode'] && (
                  <p className="text-[11px] text-red-600 mt-1">{errors['address.zipCode']}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Observações</label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="flex items-start gap-2 bg-blue-50 text-blue-800 text-[11px] p-3 rounded-xl">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Nunca registre dados de cartão ou senha do cliente neste cadastro.
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 bg-gray-100 text-gray-500 font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {saving ? 'SALVANDO...' : 'SALVAR CLIENTE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
