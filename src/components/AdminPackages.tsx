import React, { useState, useEffect } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, Trash2, Edit2, X, Copy, Star, Eye, EyeOff, ArrowUp, ArrowDown,
  AlertTriangle, Package as PackageIcon, Loader2,
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { slugify } from '../lib/utils';
import {
  AD_FORMATS,
  PACKAGE_DURATIONS,
  SERVICE_TYPES,
  type AdFormat,
  type AdLimits,
  type PackageDocument,
  type PackageDuration,
  type PackagePrices,
  type ServiceCatalogItem,
  type ServiceType,
  type WithId,
} from '../lib/commercial-types';
import {
  AD_FORMAT_META,
  SERVICE_TYPE_LABELS,
  centsToInput,
  formatCents,
  inputToCents,
} from '../lib/commercial-formatters';
import { packageSchema, formatZodErrors } from '../lib/commercial-validation';
import { PackagePreview } from './PackagePreview';

/* ─── Estado editável das subcoleções ────────────────────────────────────── */

interface EditableBenefit {
  /** id do documento existente; ausente quando o item acabou de ser criado. */
  id?: string;
  label: string;
  isActive: boolean;
}

interface EditableContent {
  id?: string;
  serviceId: string | null;
  title: string;
  type: ServiceType;
  description: string;
  quantity: number | null;
  isActive: boolean;
}

const EMPTY_PRICES: Record<PackageDuration, string> = { 1: '', 3: '', 6: '', 12: '' };
const EMPTY_LIMITS: AdLimits = {
  cover: 0, leaderboard: 0, intermediario: 0, sidebar: 0, mobile: 0,
};
const EMPTY_FORM = {
  name: '',
  slug: '',
  description: '',
  color: '#B87333',
  isActive: true,
  isFeatured: false,
  sortOrder: 0,
};

export const AdminPackages = () => {
  const { user } = useAuth();

  const [packages, setPackages] = useState<WithId<PackageDocument>[]>([]);
  const [services, setServices] = useState<WithId<ServiceCatalogItem>[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [priceInputs, setPriceInputs] = useState<Record<PackageDuration, string>>({ ...EMPTY_PRICES });
  const [adLimits, setAdLimits] = useState<AdLimits>({ ...EMPTY_LIMITS });
  const [benefits, setBenefits] = useState<EditableBenefit[]>([]);
  const [contents, setContents] = useState<EditableContent[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewDuration, setPreviewDuration] = useState<PackageDuration>(12);

  /** ids carregados na abertura — o que sumir daqui é apagado no salvamento. */
  const [initialBenefitIds, setInitialBenefitIds] = useState<string[]>([]);
  const [initialContentIds, setInitialContentIds] = useState<string[]>([]);

  /* ── Lista de pacotes ──────────────────────────────────────────────────── */
  useEffect(() => {
    const q = query(collection(db, 'packages'), orderBy('sortOrder', 'asc'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPackages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<PackageDocument>)));
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'packages');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  /* ── Catálogo de serviços (para o editor de conteúdos) ─────────────────── */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'service_catalog'),
      (snap) => {
        setServices(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as WithId<ServiceCatalogItem>))
            .filter((s) => s.isActive !== false),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'service_catalog'),
    );
    return () => unsub();
  }, []);

  /* ── Abertura do formulário ────────────────────────────────────────────── */
  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setPriceInputs({ ...EMPTY_PRICES });
    setAdLimits({ ...EMPTY_LIMITS });
    setBenefits([]);
    setContents([]);
    setInitialBenefitIds([]);
    setInitialContentIds([]);
    setErrors({});
    setPreviewDuration(12);
  };

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    // Coloca o novo pacote no fim da ordenação
    setForm({ ...EMPTY_FORM, sortOrder: packages.length });
    setIsModalOpen(true);
  };

  const loadSubcollections = async (packageId: string) => {
    const [benefitSnap, contentSnap] = await Promise.all([
      getDocs(query(collection(db, 'packages', packageId, 'benefits'), orderBy('order', 'asc'))),
      getDocs(query(collection(db, 'packages', packageId, 'contents'), orderBy('order', 'asc'))),
    ]);
    setBenefits(
      benefitSnap.docs.map((d) => ({
        id: d.id,
        label: d.data().label ?? '',
        isActive: d.data().isActive !== false,
      })),
    );
    setInitialBenefitIds(benefitSnap.docs.map((d) => d.id));
    setContents(
      contentSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          serviceId: data.serviceId ?? null,
          title: data.title ?? '',
          type: (data.type ?? 'outro') as ServiceType,
          description: data.description ?? '',
          quantity: data.quantity ?? null,
          isActive: data.isActive !== false,
        };
      }),
    );
    setInitialContentIds(contentSnap.docs.map((d) => d.id));
  };

  const openEdit = async (pkg: WithId<PackageDocument>) => {
    resetForm();
    setEditingId(pkg.id);
    setForm({
      name: pkg.name ?? '',
      slug: pkg.slug ?? '',
      description: pkg.description ?? '',
      color: pkg.color ?? '#B87333',
      isActive: pkg.isActive !== false,
      isFeatured: pkg.isFeatured === true,
      sortOrder: pkg.sortOrder ?? 0,
    });
    setPriceInputs({
      1: pkg.prices?.[1] ? centsToInput(pkg.prices[1]) : '',
      3: pkg.prices?.[3] ? centsToInput(pkg.prices[3]) : '',
      6: pkg.prices?.[6] ? centsToInput(pkg.prices[6]) : '',
      12: pkg.prices?.[12] ? centsToInput(pkg.prices[12]) : '',
    });
    setAdLimits({ ...EMPTY_LIMITS, ...(pkg.adLimits ?? {}) });
    setIsModalOpen(true);
    setLoadingDetail(true);
    try {
      await loadSubcollections(pkg.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'packages/subcoleções');
    } finally {
      setLoadingDetail(false);
    }
  };

  /** Duplicar: copia tudo, menos o slug (que é único) e o status ativo. */
  const openDuplicate = async (pkg: WithId<PackageDocument>) => {
    await openEdit(pkg);
    setEditingId(null);
    setInitialBenefitIds([]);
    setInitialContentIds([]);
    setBenefits((prev) => prev.map(({ id: _drop, ...rest }) => rest));
    setContents((prev) => prev.map(({ id: _drop, ...rest }) => rest));
    setForm((prev) => ({
      ...prev,
      name: `${prev.name} (cópia)`,
      slug: `${prev.slug}-copia`,
      isActive: false,
      isFeatured: false,
      sortOrder: packages.length,
    }));
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    resetForm();
  };

  /* ── Editor de benefícios ──────────────────────────────────────────────── */
  const addBenefit = () => setBenefits((b) => [...b, { label: '', isActive: true }]);
  const updateBenefit = (i: number, patch: Partial<EditableBenefit>) =>
    setBenefits((b) => b.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  const removeBenefit = (i: number) => setBenefits((b) => b.filter((_, idx) => idx !== i));
  const moveBenefit = (i: number, dir: -1 | 1) =>
    setBenefits((b) => {
      const target = i + dir;
      if (target < 0 || target >= b.length) return b;
      const copy = [...b];
      [copy[i], copy[target]] = [copy[target], copy[i]];
      return copy;
    });

  /* ── Editor de conteúdos ───────────────────────────────────────────────── */
  const addContent = () =>
    setContents((c) => [
      ...c,
      { serviceId: null, title: '', type: 'outro', description: '', quantity: 1, isActive: true },
    ]);
  const updateContent = (i: number, patch: Partial<EditableContent>) =>
    setContents((c) => c.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  const removeContent = (i: number) => setContents((c) => c.filter((_, idx) => idx !== i));
  const moveContent = (i: number, dir: -1 | 1) =>
    setContents((c) => {
      const target = i + dir;
      if (target < 0 || target >= c.length) return c;
      const copy = [...c];
      [copy[i], copy[target]] = [copy[target], copy[i]];
      return copy;
    });

  /** Ao escolher um serviço do catálogo, herda título, tipo e quantidade padrão. */
  const applyService = (i: number, serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) {
      updateContent(i, { serviceId: null });
      return;
    }
    updateContent(i, {
      serviceId: svc.id,
      title: svc.name,
      type: svc.type,
      description: svc.description ?? '',
      quantity: svc.defaultQuantity ?? null,
    });
  };

  /* ── Dados derivados para validação e preview ──────────────────────────── */
  const buildPrices = (): PackagePrices => ({
    1: inputToCents(priceInputs[1]),
    3: inputToCents(priceInputs[3]),
    6: inputToCents(priceInputs[6]),
    12: inputToCents(priceInputs[12]),
  });

  const previewData = {
    name: form.name,
    description: form.description,
    color: form.color,
    isActive: form.isActive,
    isFeatured: form.isFeatured,
    prices: buildPrices(),
    adLimits,
  };

  /* ── Salvamento ────────────────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const slug = form.slug.trim() || slugify(form.name);
    const payload = {
      name: form.name.trim(),
      slug,
      description: form.description.trim(),
      color: form.color,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      sortOrder: Number(form.sortOrder) || 0,
      prices: buildPrices(),
      adLimits,
    };

    // Mesma validação que a API repetirá no servidor
    const parsed = packageSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(formatZodErrors(parsed.error));
      return;
    }

    const cleanBenefits = benefits.filter((b) => b.label.trim().length >= 2);
    const cleanContents = contents.filter((c) => c.title.trim().length >= 2);
    if (benefits.length !== cleanBenefits.length || contents.length !== cleanContents.length) {
      setErrors({ _: 'Existem benefícios ou serviços sem título preenchido.' });
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      const pkgRef = editingId
        ? doc(db, 'packages', editingId)
        : doc(collection(db, 'packages'));

      const uid = user?.uid ?? 'desconhecido';
      batch.set(
        pkgRef,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          ...(editingId ? {} : { createdAt: serverTimestamp(), createdBy: uid }),
        },
        { merge: true },
      );

      // Subcoleções: atualiza os que ficaram, cria os novos e apaga os removidos
      const keptBenefitIds: string[] = [];
      cleanBenefits.forEach((b, index) => {
        const ref = b.id
          ? doc(db, 'packages', pkgRef.id, 'benefits', b.id)
          : doc(collection(db, 'packages', pkgRef.id, 'benefits'));
        keptBenefitIds.push(ref.id);
        batch.set(
          ref,
          {
            label: b.label.trim(),
            order: index,
            isActive: b.isActive,
            ...(b.id ? {} : { createdAt: serverTimestamp() }),
          },
          { merge: true },
        );
      });
      initialBenefitIds
        .filter((id) => !keptBenefitIds.includes(id))
        .forEach((id) => batch.delete(doc(db, 'packages', pkgRef.id, 'benefits', id)));

      const keptContentIds: string[] = [];
      cleanContents.forEach((c, index) => {
        const ref = c.id
          ? doc(db, 'packages', pkgRef.id, 'contents', c.id)
          : doc(collection(db, 'packages', pkgRef.id, 'contents'));
        keptContentIds.push(ref.id);
        batch.set(
          ref,
          {
            serviceId: c.serviceId,
            title: c.title.trim(),
            type: c.type,
            description: c.description.trim(),
            quantity: c.quantity,
            order: index,
            isActive: c.isActive,
            ...(c.id ? {} : { createdAt: serverTimestamp() }),
          },
          { merge: true },
        );
      });
      initialContentIds
        .filter((id) => !keptContentIds.includes(id))
        .forEach((id) => batch.delete(doc(db, 'packages', pkgRef.id, 'contents', id)));

      await batch.commit();
      closeModal();
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'packages');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Desativação lógica. Pacote vendido nunca é apagado: o histórico dos
   * contratos depende do packageSnapshot, mas a listagem de novos contratos
   * precisa saber que ele saiu do catálogo.
   */
  const toggleActive = async (pkg: WithId<PackageDocument>) => {
    let activeContracts = 0;
    if (pkg.isActive) {
      try {
        const snap = await getDocs(
          query(collection(db, 'contracts'), where('packageId', '==', pkg.id)),
        );
        activeContracts = snap.docs.filter((d) => d.data().status === 'active').length;
      } catch {
        // Sem permissão de leitura em contracts ou coleção ainda inexistente:
        // segue sem o aviso em vez de bloquear a operação
      }
      const aviso = activeContracts
        ? `\n\nEste pacote possui ${activeContracts} contrato(s) ativo(s). Eles continuam valendo pelo snapshot, mas novos contratos não poderão selecioná-lo.`
        : '';
      if (!window.confirm(`Desativar o pacote "${pkg.name}"?${aviso}`)) return;
    }

    try {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'packages', pkg.id),
        {
          isActive: !pkg.isActive,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? 'desconhecido',
        },
        { merge: true },
      );
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'packages');
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">
            Pacotes <span className="text-red-600">Comerciais</span>
          </h1>
          <p className="text-gray-500 text-sm">
            {packages.length} pacote{packages.length !== 1 ? 's' : ''} no catálogo. Valores
            armazenados em centavos.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-100"
        >
          <Plus size={20} /> NOVO PACOTE
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-gray-200 rounded-3xl">
          <PackageIcon size={34} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-bold">Nenhum pacote cadastrado.</p>
          <p className="text-gray-400 text-sm mt-1">
            Crie Bronze, Prata, Ouro e Master para começar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-xl shrink-0"
                  style={{ backgroundColor: pkg.color || '#B87333' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black text-lg tracking-tighter text-gray-900 truncate">
                      {pkg.name}
                    </h3>
                    {pkg.isFeatured && (
                      <span className="flex items-center gap-1 bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                        <Star size={9} fill="currentColor" /> Destaque
                      </span>
                    )}
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        pkg.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {pkg.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">/{pkg.slug}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                    {PACKAGE_DURATIONS.map((d) => (
                      <div key={d}>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block">
                          {d} {d === 1 ? 'mês' : 'meses'}
                        </span>
                        <span className="text-xs font-bold text-gray-800">
                          {pkg.prices?.[d] ? formatCents(pkg.prices[d]) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-1.5 mt-4 pt-3 border-t border-gray-100">
                <button
                  onClick={() => openEdit(pkg)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <Edit2 size={12} /> Editar
                </button>
                <button
                  onClick={() => openDuplicate(pkg)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Copy size={12} /> Duplicar
                </button>
                <button
                  onClick={() => toggleActive(pkg)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                    pkg.isActive
                      ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                      : 'text-green-700 bg-green-50 hover:bg-green-100'
                  }`}
                >
                  {pkg.isActive ? <EyeOff size={12} /> : <Eye size={12} />}
                  {pkg.isActive ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de cadastro/edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-6xl rounded-3xl shadow-2xl my-8 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 sticky top-0 z-10">
              <h2 className="text-xl font-black uppercase tracking-tighter">
                {editingId ? 'Editar' : 'Novo'} <span className="text-red-600">Pacote</span>
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-red-600 transition-colors">
                <X size={24} />
              </button>
            </div>

            {loadingDetail ? (
              <div className="p-20 flex items-center justify-center text-gray-400 gap-2">
                <Loader2 size={20} className="animate-spin" /> Carregando pacote...
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-5 gap-8 p-8">
                {/* ── Colunas 1-3: formulário ─────────────────────────── */}
                <div className="lg:col-span-3 space-y-8">
                  {errors._ && (
                    <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs p-3 rounded-xl">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {errors._}
                    </div>
                  )}

                  {/* Camada 1 — Cadastro */}
                  <section>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">
                      1. Cadastro do pacote
                    </h3>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Nome</label>
                          <input
                            value={form.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              setForm((f) => ({
                                ...f,
                                name,
                                // Slug acompanha o nome enquanto não for editado à mão
                                slug: !editingId && (!f.slug || f.slug === slugify(f.name)) ? slugify(name) : f.slug,
                              }));
                            }}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                          />
                          {errors.name && <p className="text-[11px] text-red-600 mt-1">{errors.name}</p>}
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Slug</label>
                          <input
                            value={form.slug}
                            onChange={(e) => setForm({ ...form, slug: e.target.value })}
                            placeholder="ouro"
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:border-red-600"
                          />
                          {errors.slug && <p className="text-[11px] text-red-600 mt-1">{errors.slug}</p>}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Descrição</label>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          className="w-full border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-red-600"
                        />
                        {errors.description && <p className="text-[11px] text-red-600 mt-1">{errors.description}</p>}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Cor</label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={/^#[0-9A-Fa-f]{6}$/.test(form.color) ? form.color : '#B87333'}
                              onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })}
                              className="w-12 h-12 rounded-xl border border-gray-200 cursor-pointer"
                            />
                            <input
                              value={form.color}
                              onChange={(e) => setForm({ ...form, color: e.target.value })}
                              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 font-mono text-sm focus:outline-none focus:border-red-600"
                            />
                          </div>
                          {errors.color && <p className="text-[11px] text-red-600 mt-1">{errors.color}</p>}
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Ordem</label>
                          <input
                            type="number"
                            min={0}
                            value={form.sortOrder}
                            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                          />
                        </div>
                        <div className="flex flex-col justify-end gap-2 pb-1">
                          <label className="flex items-center gap-2 text-sm font-bold text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.isActive}
                              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                              className="w-4 h-4 accent-red-600"
                            />
                            Ativo
                          </label>
                          <label className="flex items-center gap-2 text-sm font-bold text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.isFeatured}
                              onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
                              className="w-4 h-4 accent-amber-500"
                            />
                            Mais popular
                          </label>
                        </div>
                      </div>

                      {/* Preços por duração */}
                      <div>
                        <label className="block text-xs font-bold uppercase text-gray-400 mb-2">
                          Preços por período (R$)
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {PACKAGE_DURATIONS.map((d) => (
                            <div key={d} className="border border-gray-200 rounded-xl p-3">
                              <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                                {d} {d === 1 ? 'mês' : 'meses'}
                              </span>
                              <input
                                inputMode="decimal"
                                placeholder="0,00"
                                value={priceInputs[d]}
                                onChange={(e) =>
                                  setPriceInputs((p) => ({ ...p, [d]: e.target.value }))
                                }
                                onBlur={(e) =>
                                  setPriceInputs((p) => ({
                                    ...p,
                                    [d]: e.target.value ? centsToInput(inputToCents(e.target.value)) : '',
                                  }))
                                }
                                className="w-full border-0 border-b border-gray-200 px-0 py-1 font-bold text-gray-900 focus:outline-none focus:border-red-600"
                              />
                              <span className="block text-[10px] text-gray-400 mt-1 font-mono">
                                {inputToCents(priceInputs[d])} centavos
                              </span>
                            </div>
                          ))}
                        </div>
                        {errors.prices && <p className="text-[11px] text-red-600 mt-1">{errors.prices}</p>}
                      </div>
                    </div>
                  </section>

                  {/* Camada 2 — Benefícios, conteúdos e limites */}
                  <section>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">
                      2. Conteúdos e benefícios do pacote
                    </h3>

                    {/* Benefícios */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase text-gray-500">Benefícios</span>
                        <button
                          type="button"
                          onClick={addBenefit}
                          className="text-[11px] font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                        >
                          <Plus size={13} /> Adicionar
                        </button>
                      </div>
                      {benefits.length === 0 ? (
                        <p className="text-xs text-gray-400 italic py-2">Nenhum benefício adicionado.</p>
                      ) : (
                        <div className="space-y-2">
                          {benefits.map((b, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="flex flex-col">
                                <button type="button" onClick={() => moveBenefit(i, -1)} disabled={i === 0}
                                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                                  <ArrowUp size={12} />
                                </button>
                                <button type="button" onClick={() => moveBenefit(i, 1)} disabled={i === benefits.length - 1}
                                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                              <input
                                value={b.label}
                                onChange={(e) => updateBenefit(i, { label: e.target.value })}
                                placeholder="Ex: Suporte por WhatsApp"
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600"
                              />
                              <button
                                type="button"
                                onClick={() => updateBenefit(i, { isActive: !b.isActive })}
                                title={b.isActive ? 'Ativo' : 'Inativo'}
                                className={b.isActive ? 'text-green-600' : 'text-gray-300'}
                              >
                                {b.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
                              </button>
                              <button type="button" onClick={() => removeBenefit(i)} className="text-gray-300 hover:text-red-600">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Conteúdos / serviços */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase text-gray-500">Conteúdos e serviços</span>
                        <button
                          type="button"
                          onClick={addContent}
                          className="text-[11px] font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                        >
                          <Plus size={13} /> Adicionar
                        </button>
                      </div>
                      {contents.length === 0 ? (
                        <p className="text-xs text-gray-400 italic py-2">Nenhum serviço adicionado.</p>
                      ) : (
                        <div className="space-y-3">
                          {contents.map((c, i) => (
                            <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col">
                                  <button type="button" onClick={() => moveContent(i, -1)} disabled={i === 0}
                                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                                    <ArrowUp size={12} />
                                  </button>
                                  <button type="button" onClick={() => moveContent(i, 1)} disabled={i === contents.length - 1}
                                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                                    <ArrowDown size={12} />
                                  </button>
                                </div>
                                <select
                                  value={c.serviceId ?? ''}
                                  onChange={(e) => applyService(i, e.target.value)}
                                  className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white focus:outline-none focus:border-red-600"
                                >
                                  <option value="">Serviço avulso</option>
                                  {services.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                                <input
                                  value={c.title}
                                  onChange={(e) => updateContent(i, { title: e.target.value })}
                                  placeholder="Título do serviço"
                                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600"
                                />
                                <button type="button" onClick={() => removeContent(i)} className="text-gray-300 hover:text-red-600">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              <div className="flex gap-2 flex-wrap pl-6">
                                <select
                                  value={c.type}
                                  onChange={(e) => updateContent(i, { type: e.target.value as ServiceType })}
                                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-red-600"
                                >
                                  {SERVICE_TYPES.map((t) => (
                                    <option key={t} value={t}>{SERVICE_TYPE_LABELS[t] ?? t}</option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  value={c.quantity ?? ''}
                                  onChange={(e) =>
                                    updateContent(i, {
                                      quantity: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder="Qtd."
                                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-red-600"
                                />
                                <input
                                  value={c.description}
                                  onChange={(e) => updateContent(i, { description: e.target.value })}
                                  placeholder="Descrição (opcional)"
                                  className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-red-600"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Limites de anúncios */}
                    <div>
                      <span className="text-xs font-bold uppercase text-gray-500 block mb-2">
                        Limites de anúncios por formato
                      </span>
                      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                        {AD_FORMATS.map((format) => (
                          <div key={format} className="flex items-center gap-3 p-3">
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-bold text-gray-800 block">
                                {AD_FORMAT_META[format].label}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono">
                                {AD_FORMAT_META[format].dims} — {AD_FORMAT_META[format].desc}
                              </span>
                            </div>
                            <input
                              type="number"
                              min={0}
                              value={adLimits[format]}
                              onChange={(e) =>
                                setAdLimits((l) => ({
                                  ...l,
                                  [format]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                }))
                              }
                              className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold focus:outline-none focus:border-red-600"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        0 significa que o formato não está incluído no pacote.
                      </p>
                      {errors.adLimits && <p className="text-[11px] text-red-600 mt-1">{errors.adLimits}</p>}
                    </div>
                  </section>

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
                      {saving && <Loader2 size={16} className="animate-spin" />}
                      {saving ? 'SALVANDO...' : 'SALVAR PACOTE'}
                    </button>
                  </div>
                </div>

                {/* ── Colunas 4-5: Camada 3 — pré-visualização ────────── */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-24">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">
                      3. Pré-visualização
                    </h3>
                    <PackagePreview
                      data={previewData}
                      benefits={benefits.map((b) => ({ label: b.label || 'Benefício', isActive: b.isActive }))}
                      contents={contents.map((c) => ({
                        title: c.title || 'Serviço',
                        type: c.type,
                        description: c.description,
                        quantity: c.quantity,
                        isActive: c.isActive,
                      }))}
                      mode="interno"
                      duration={previewDuration}
                      onDurationChange={setPreviewDuration}
                    />
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
