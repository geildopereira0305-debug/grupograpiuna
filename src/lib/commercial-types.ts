/**
 * Tipagens do módulo comercial — pacotes, clientes, contratos, parcelas,
 * publicidade contratada e financeiro.
 *
 * Este arquivo é PROPOSITALMENTE livre de imports: ele é consumido tanto pelos
 * componentes React (SDK do cliente) quanto pelas rotas em api/ (Admin SDK), e
 * cada lado tem seu próprio tipo de Timestamp. Ver `FirestoreTimestamp` abaixo.
 *
 * Convenção monetária: todo valor é inteiro em CENTAVOS. R$ 1.250,00 => 125000.
 * Nunca usar float para dinheiro; a formatação acontece só na interface.
 */

/* ─── Primitivos ─────────────────────────────────────────────────────────── */

/** Formatos publicitários — espelham os tamanhos já usados em AdminAds/AdBanner. */
export type AdFormat = 'cover' | 'leaderboard' | 'intermediario' | 'sidebar' | 'mobile';

export const AD_FORMATS: readonly AdFormat[] = [
  'cover',
  'leaderboard',
  'intermediario',
  'sidebar',
  'mobile',
] as const;

/** Durações comercializadas, em meses. */
export type PackageDuration = 1 | 3 | 6 | 12;

export const PACKAGE_DURATIONS: readonly PackageDuration[] = [1, 3, 6, 12] as const;

/**
 * Estrutura mínima comum ao Timestamp do SDK web e do Admin SDK.
 * Permite tipar documentos sem acoplar este arquivo a um dos dois SDKs.
 */
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
}

/** Data de negócio no formato YYYY-MM-DD (sem fuso, para vencimentos). */
export type BusinessDate = string;

/** Campos de auditoria repetidos em quase todos os documentos. */
export interface AuditFields {
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  createdBy: string;
  updatedBy: string;
}

/* ─── Papéis e permissões ────────────────────────────────────────────────── */

/**
 * Papéis do módulo comercial. `editor` é legado do portal editorial e é mantido
 * durante a migração (mapeado temporariamente para gerente).
 */
export type CommercialRole =
  | 'admin'
  | 'gerente'
  | 'comercial'
  | 'financeiro'
  | 'operador_anuncios'
  | 'visualizacao';

export type LegacyRole = 'editor' | 'user';

export type UserRole = CommercialRole | LegacyRole;

/** Permissões granulares — usadas por `can()` em vez de comparar papéis direto. */
export type Permission =
  | 'packages.read'
  | 'packages.write'
  | 'clients.read'
  | 'clients.write'
  | 'contracts.read'
  | 'contracts.create'
  | 'contracts.cancel'
  | 'finance.read'
  | 'finance.write'
  | 'finance.refund'
  | 'ads.read'
  | 'ads.write'
  | 'ads.approve'
  | 'ads.publish'
  | 'users.read'
  | 'users.write'
  | 'reports.read';

export interface UserDocument {
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/* ─── Catálogo: packages ─────────────────────────────────────────────────── */

/** Preço por duração, em centavos. */
export type PackagePrices = Record<PackageDuration, number>;

/** Cota de anúncios por formato. 0 = formato não incluído no pacote. */
export type AdLimits = Record<AdFormat, number>;

/** packages/{packageId} */
export interface PackageDocument extends AuditFields {
  name: string;
  slug: string;
  description: string;
  /** Cor de destaque em hexadecimal (#RRGGBB). */
  color: string;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  prices: PackagePrices;
  adLimits: AdLimits;
}

/** packages/{packageId}/benefits/{benefitId} — texto comercial livre. */
export interface PackageBenefit {
  label: string;
  order: number;
  isActive: boolean;
  createdAt: FirestoreTimestamp;
}

/** Tipos de serviço entregável. */
export type ServiceType =
  | 'materia'
  | 'redes_sociais'
  | 'cobertura_evento'
  | 'programa'
  | 'video'
  | 'banner_portal'
  | 'outro';

export const SERVICE_TYPES: readonly ServiceType[] = [
  'materia',
  'redes_sociais',
  'cobertura_evento',
  'programa',
  'video',
  'banner_portal',
  'outro',
] as const;

/** packages/{packageId}/contents/{contentId} — serviço entregável do pacote. */
export interface PackageContent {
  /** Referência ao service_catalog; null quando o item é avulso. */
  serviceId: string | null;
  title: string;
  type: ServiceType;
  description: string;
  /** null = sem quantidade definida (ex.: sob demanda). */
  quantity: number | null;
  order: number;
  isActive: boolean;
  createdAt: FirestoreTimestamp;
}

/** service_catalog/{serviceId} — serviços reutilizáveis entre pacotes. */
export interface ServiceCatalogItem {
  name: string;
  type: ServiceType;
  description: string;
  isActive: boolean;
  defaultQuantity: number | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/* ─── Clientes ───────────────────────────────────────────────────────────── */

export type DocumentType = 'cpf' | 'cnpj';
export type ClientStatus = 'active' | 'inactive';

export interface ClientAddress {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  /** UF com 2 letras. */
  state: string;
  zipCode: string;
}

/** clients/{clientId} — nunca armazenar cartão, senha ou dado sensível de pagamento. */
export interface ClientDocument extends AuditFields {
  legalName: string;
  tradeName: string;
  documentType: DocumentType;
  /** Documento como digitado/formatado, para exibição. */
  documentNumber: string;
  /** Somente dígitos — usado para busca e checagem de duplicidade. */
  documentNormalized: string;
  email: string;
  /** E-mail em minúsculas, para busca. */
  emailNormalized: string;
  phone: string;
  whatsapp: string;
  address: ClientAddress;
  contactName: string;
  notes: string;
  status: ClientStatus;
}

/**
 * client_identifiers/{documentNormalized} — índice de unicidade.
 * A criação deste documento dentro da transação impede CPF/CNPJ duplicado
 * quando dois usuários salvam ao mesmo tempo.
 */
export interface ClientIdentifier {
  clientId: string;
  createdAt: FirestoreTimestamp;
}

/* ─── Contratos ──────────────────────────────────────────────────────────── */

export type PaymentMethod =
  | 'pix'
  | 'boleto'
  | 'cartao'
  | 'dinheiro'
  | 'transferencia'
  | 'outro';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'pix',
  'boleto',
  'cartao',
  'dinheiro',
  'transferencia',
  'outro',
] as const;

export type ContractStatus = 'draft' | 'pending' | 'active' | 'expired' | 'cancelled';

/**
 * Retrato do pacote no momento da venda. Existe para que alterações futuras de
 * preço, benefícios ou limites NÃO mudem retroativamente o que já foi vendido.
 */
export interface PackageContentSnapshot {
  title: string;
  type: ServiceType;
  description: string;
  quantity: number | null;
}

export interface PackageSnapshot {
  name: string;
  color: string;
  durationMonths: PackageDuration;
  priceCents: number;
  benefits: string[];
  contents: PackageContentSnapshot[];
  adLimits: AdLimits;
}

/** contracts/{contractId} */
export interface ContractDocument extends AuditFields {
  clientId: string;
  packageId: string;
  packageSnapshot: PackageSnapshot;
  durationMonths: PackageDuration;
  /** Preço de tabela antes de desconto. */
  subtotalCents: number;
  /** Desconto manual concedido; 0 quando não houver. */
  discountCents: number;
  /** Motivo obrigatório quando discountCents > 0. */
  discountReason: string;
  /** subtotalCents - discountCents. */
  totalCents: number;
  installmentCount: number;
  firstDueDate: BusinessDate;
  startDate: BusinessDate;
  endDate: BusinessDate;
  sellerId: string;
  paymentMethod: PaymentMethod;
  status: ContractStatus;
  /** Chave de idempotência que originou o contrato (evita duplicidade). */
  idempotencyKey: string | null;
}

/* ─── Parcelas e pagamentos ──────────────────────────────────────────────── */

export type InstallmentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

/** installments/{installmentId} — coleção de topo, para relatórios por vencimento. */
export interface InstallmentDocument {
  contractId: string;
  clientId: string;
  /** Posição da parcela no contrato, começando em 1. */
  number: number;
  dueDate: BusinessDate;
  amountCents: number;
  status: InstallmentStatus;
  /** Soma dos pagamentos registrados; permite baixa parcial. */
  paidCents: number;
  paidAt: FirestoreTimestamp | null;
  paymentMethod: PaymentMethod | null;
  updatedAt: FirestoreTimestamp;
}

/** installments/{installmentId}/payments/{paymentId} */
export interface PaymentDocument {
  amountCents: number;
  paidAt: FirestoreTimestamp;
  method: PaymentMethod;
  /** Identificador externo (nº do boleto, id da transação PIX, etc.). */
  reference: string;
  notes: string;
  registeredBy: string;
}

/* ─── Publicidade contratada ─────────────────────────────────────────────── */

/**
 * contracts/{contractId}/adUsage/{format}
 * `used` conta ALOCAÇÕES ATIVAS — não impressões nem visualizações.
 */
export interface AdUsageDocument {
  format: AdFormat;
  limit: number;
  used: number;
  updatedAt: FirestoreTimestamp;
}

export type ClientAdStatus =
  | 'draft'
  | 'waiting_review'
  | 'approved'
  | 'published'
  | 'paused'
  | 'expired';

/** client_ads/{clientAdId} — coleção PRIVADA; não expor dados comerciais em `ads`. */
export interface ClientAdDocument extends AuditFields {
  clientId: string;
  contractId: string;
  format: AdFormat;
  imageUrl: string;
  link: string;
  page: string;
  status: ClientAdStatus;
  /** ID do documento espelhado na coleção pública `ads`; null enquanto não publicado. */
  publicAdId: string | null;
}

/**
 * ads/{adId} — projeção PÚBLICA consumida pelo AdBanner.
 * `source` distingue anúncios editoriais antigos dos vindos de contrato.
 */
export interface PublicAdDocument {
  size: AdFormat;
  imageUrl: string;
  link: string;
  page: string;
  active: boolean;
  source: 'legacy' | 'contract';
  /** Referência ao client_ads que originou a projeção; null nos legados. */
  allocationId: string | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/* ─── Financeiro consolidado ─────────────────────────────────────────────── */

/**
 * financial_summaries/{YYYY-MM} — resumo mensal atualizado na mesma transação
 * da baixa, para o dashboard não precisar ler todas as parcelas.
 */
export interface FinancialSummaryDocument {
  /** Competência no formato YYYY-MM. */
  period: string;
  contractedCents: number;
  receivedCents: number;
  pendingCents: number;
  overdueCents: number;
  contractCount: number;
  updatedAt: FirestoreTimestamp;
}

/* ─── Auditoria ──────────────────────────────────────────────────────────── */

export type ActivityAction =
  | 'contract.create'
  | 'contract.cancel'
  | 'payment.register'
  | 'payment.refund'
  | 'ad.assign'
  | 'ad.publish'
  | 'ad.pause'
  | 'package.update'
  | 'client.create'
  | 'client.update'
  | 'user.create'
  | 'user.update';

/** activity_logs/{logId} — trilha de auditoria das operações sensíveis. */
export interface ActivityLogDocument {
  action: ActivityAction;
  userId: string;
  userEmail: string;
  /** Documentos afetados, ex.: { contractId, clientId }. */
  targets: Record<string, string>;
  /** Contexto adicional serializável (valores, motivo, etc.). */
  metadata: Record<string, unknown>;
  createdAt: FirestoreTimestamp;
}

/* ─── Captação pública ───────────────────────────────────────────────────── */

export type LeadStatus = 'new' | 'contacted' | 'converted' | 'discarded';

/**
 * sales_leads/{leadId} — solicitações vindas da página /anuncie.
 * Um lead NUNCA vira cliente ou contrato automaticamente.
 */
export interface SalesLeadDocument {
  name: string;
  company: string;
  email: string;
  phone: string;
  /** Pacote de interesse; null quando o visitante não escolheu. */
  packageId: string | null;
  durationMonths: PackageDuration | null;
  message: string;
  status: LeadStatus;
  createdAt: FirestoreTimestamp;
}

/* ─── Nomes de coleção ───────────────────────────────────────────────────── */

/** Fonte única dos caminhos, para evitar strings soltas pelo código. */
export const COLLECTIONS = {
  packages: 'packages',
  benefits: 'benefits',
  contents: 'contents',
  serviceCatalog: 'service_catalog',
  clients: 'clients',
  clientIdentifiers: 'client_identifiers',
  contracts: 'contracts',
  adUsage: 'adUsage',
  installments: 'installments',
  payments: 'payments',
  clientAds: 'client_ads',
  ads: 'ads',
  financialSummaries: 'financial_summaries',
  activityLogs: 'activity_logs',
  salesLeads: 'sales_leads',
  users: 'users',
} as const;

/** Documento do Firestore acrescido do seu id — o formato usado nas telas. */
export type WithId<T> = T & { id: string };
