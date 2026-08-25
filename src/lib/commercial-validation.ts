/**
 * Validações estruturais do módulo comercial (Zod).
 *
 * Estes schemas são a fonte única de validação e rodam nos DOIS lados:
 * no formulário React, para dar retorno imediato ao usuário, e novamente nas
 * rotas de api/, porque qualquer cliente pode chamar um endpoint HTTP direto.
 * Validar só no navegador não protege o banco.
 *
 * Valores monetários são sempre inteiros em CENTAVOS.
 */
import { z } from 'zod';
import {
  AD_FORMATS,
  PACKAGE_DURATIONS,
  PAYMENT_METHODS,
  SERVICE_TYPES,
} from './commercial-types';

/* ─── Primitivos reutilizáveis ───────────────────────────────────────────── */

export const adFormatSchema = z.enum(AD_FORMATS as unknown as [string, ...string[]]);

/** Duração em meses. Vem como número (1 | 3 | 6 | 12). */
export const packageDurationSchema = z
  .union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)])
  .describe('Duração em meses');

/** Cor de destaque no formato #RRGGBB. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use uma cor hexadecimal no formato #RRGGBB');

/** Dinheiro: inteiro, em centavos, nunca negativo. */
export const moneyCentsSchema = z
  .number()
  .int('O valor deve estar em centavos (número inteiro)')
  .nonnegative('O valor não pode ser negativo');

/** Quantidade/limite: inteiro não negativo (rejeita decimais). */
export const countSchema = z
  .number()
  .int('Informe um número inteiro')
  .nonnegative('O número não pode ser negativo');

/**
 * Data de negócio YYYY-MM-DD. Além do formato, confere se a data existe de
 * verdade no calendário — assim 2026-02-30 é rejeitado.
 */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1) return false;
    // Dia 0 do mês seguinte = último dia do mês atual
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }, 'Data inexistente no calendário');

/** Competência mensal YYYY-MM, usada em financial_summaries. */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM');

export const paymentMethodSchema = z.enum(
  PAYMENT_METHODS as unknown as [string, ...string[]],
);

export const serviceTypeSchema = z.enum(
  SERVICE_TYPES as unknown as [string, ...string[]],
);

/* ─── Documentos: CPF / CNPJ ─────────────────────────────────────────────── */

/** Remove tudo que não for dígito. */
export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

/** Valida os dois dígitos verificadores do CPF. */
export function isValidCPF(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  // Sequências repetidas (000..., 111...) passam no cálculo, mas são inválidas
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digitAt = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cpf[i]) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digitAt(9) === Number(cpf[9]) && digitAt(10) === Number(cpf[10]);
}

/** Valida os dois dígitos verificadores do CNPJ. */
export function isValidCNPJ(raw: string): boolean {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digitAt = (length: number): number => {
    // Pesos decrescentes de 2..9, reiniciando em 9
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cnpj[i]) * weight;
      weight = weight - 1 < 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return digitAt(12) === Number(cnpj[12]) && digitAt(13) === Number(cnpj[13]);
}

export const documentTypeSchema = z.enum(['cpf', 'cnpj']);

/* ─── Catálogo: pacotes ──────────────────────────────────────────────────── */

/** Preço por duração. As chaves numéricas espelham PackageDuration. */
export const packagePricesSchema = z.object({
  1: moneyCentsSchema,
  3: moneyCentsSchema,
  6: moneyCentsSchema,
  12: moneyCentsSchema,
});

/** Cota por formato publicitário. 0 = formato não incluído. */
export const adLimitsSchema = z.object({
  cover: countSchema,
  leaderboard: countSchema,
  intermediario: countSchema,
  sidebar: countSchema,
  mobile: countSchema,
});

export const packageSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(80, 'Nome muito longo'),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífen'),
    description: z.string().trim().max(500, 'Descrição muito longa'),
    color: hexColorSchema,
    isActive: z.boolean(),
    isFeatured: z.boolean(),
    sortOrder: countSchema,
    prices: packagePricesSchema,
    adLimits: adLimitsSchema,
  })
  .refine(
    (pkg) => !pkg.isActive || PACKAGE_DURATIONS.some((d) => pkg.prices[d] > 0),
    {
      // Evita publicar pacote ativo sem nenhum preço — erro comum no seed
      message: 'Um pacote ativo precisa ter preço em pelo menos uma duração',
      path: ['prices'],
    },
  );

export const packageBenefitSchema = z.object({
  label: z.string().trim().min(2, 'Descreva o benefício').max(160),
  order: countSchema,
  isActive: z.boolean(),
});

export const packageContentSchema = z.object({
  serviceId: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(2, 'Informe o título do serviço').max(120),
  type: serviceTypeSchema,
  description: z.string().trim().max(500),
  quantity: countSchema.positive('A quantidade deve ser maior que zero').nullable(),
  order: countSchema,
  isActive: z.boolean(),
});

export const serviceCatalogSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: serviceTypeSchema,
  description: z.string().trim().max(500),
  isActive: z.boolean(),
  defaultQuantity: countSchema.positive().nullable(),
});

/* ─── Clientes ───────────────────────────────────────────────────────────── */

export const clientAddressSchema = z.object({
  street: z.string().trim().max(160),
  number: z.string().trim().max(20),
  complement: z.string().trim().max(80),
  neighborhood: z.string().trim().max(80),
  city: z.string().trim().max(80),
  state: z
    .string()
    .trim()
    .length(2, 'Use a sigla do estado com 2 letras')
    .regex(/^[A-Za-z]{2}$/, 'UF inválida')
    .transform((uf) => uf.toUpperCase()),
  zipCode: z
    .string()
    .trim()
    .refine((cep) => cep === '' || onlyDigits(cep).length === 8, 'CEP inválido'),
});

export const clientSchema = z
  .object({
    legalName: z.string().trim().min(2, 'Informe a razão social').max(160),
    tradeName: z.string().trim().max(160),
    documentType: documentTypeSchema,
    documentNumber: z.string().trim().min(11, 'Documento incompleto').max(20),
    email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
    phone: z.string().trim().max(20),
    whatsapp: z.string().trim().max(20),
    address: clientAddressSchema,
    contactName: z.string().trim().max(120),
    notes: z.string().trim().max(1000),
    status: z.enum(['active', 'inactive']),
  })
  .refine(
    (client) =>
      client.documentType === 'cpf'
        ? isValidCPF(client.documentNumber)
        : isValidCNPJ(client.documentNumber),
    {
      message: 'CPF/CNPJ inválido — confira os dígitos',
      path: ['documentNumber'],
    },
  );

/* ─── Contratos ──────────────────────────────────────────────────────────── */

/**
 * Payload de fechamento de contrato.
 *
 * Repare no que NÃO está aqui: preço, total e snapshot do pacote. Esses valores
 * são lidos do Firestore pelo servidor em api/commercial/close-contract.ts.
 * Aceitá-los do navegador permitiria fechar um contrato com preço arbitrário.
 */
export const closeContractSchema = z
  .object({
    clientId: z.string().trim().min(1, 'Selecione o cliente'),
    packageId: z.string().trim().min(1, 'Selecione o pacote'),
    durationMonths: packageDurationSchema,
    installmentCount: z
      .number()
      .int()
      .min(1, 'Mínimo de 1 parcela')
      .max(12, 'Máximo de 12 parcelas'),
    firstDueDate: businessDateSchema,
    /** Início da vigência; o servidor assume hoje (fuso de negócio) se omitido. */
    startDate: businessDateSchema.optional(),
    paymentMethod: paymentMethodSchema,
    sellerId: z.string().trim().min(1, 'Informe o vendedor'),
    discountCents: moneyCentsSchema.default(0),
    discountReason: z.string().trim().max(300).default(''),
    /** Impede contrato duplicado em clique duplo ou recarga durante a resposta. */
    idempotencyKey: z.string().trim().min(8, 'Chave de idempotência inválida').max(120),
  })
  .refine((c) => c.discountCents === 0 || c.discountReason.trim().length >= 3, {
    // Desconto sem justificativa impede auditoria depois
    message: 'Informe o motivo do desconto',
    path: ['discountReason'],
  });

export const contractStatusSchema = z.enum([
  'draft',
  'pending',
  'active',
  'expired',
  'cancelled',
]);

export const cancelContractSchema = z.object({
  contractId: z.string().trim().min(1),
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(300),
});

/* ─── Financeiro ─────────────────────────────────────────────────────────── */

/**
 * Baixa de parcela. O servidor valida ainda: parcela existe, não está cancelada
 * e o valor não excede o saldo em aberto.
 */
export const registerPaymentSchema = z.object({
  installmentId: z.string().trim().min(1),
  amountCents: moneyCentsSchema.positive('O valor recebido deve ser maior que zero'),
  paidAt: businessDateSchema,
  method: paymentMethodSchema,
  reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(500).default(''),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const installmentStatusSchema = z.enum([
  'pending',
  'paid',
  'overdue',
  'cancelled',
]);

/* ─── Publicidade contratada ─────────────────────────────────────────────── */

/**
 * Alocação de anúncio. A checagem de cota (used < limit) é feita pelo servidor
 * dentro de uma transação — o schema valida apenas a forma do payload.
 */
export const assignAdSchema = z.object({
  clientId: z.string().trim().min(1, 'Selecione o cliente'),
  contractId: z.string().trim().min(1, 'Selecione o contrato'),
  format: adFormatSchema,
  imageUrl: z.url('Informe uma URL de imagem válida'),
  link: z.url('Informe um link válido'),
  page: z.string().trim().min(1, 'Selecione a página'),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const clientAdStatusSchema = z.enum([
  'draft',
  'waiting_review',
  'approved',
  'published',
  'paused',
  'expired',
]);

export const updateClientAdStatusSchema = z.object({
  clientAdId: z.string().trim().min(1),
  status: clientAdStatusSchema,
  reason: z.string().trim().max(300).default(''),
});

/* ─── Usuários ───────────────────────────────────────────────────────────── */

export const commercialRoleSchema = z.enum([
  'admin',
  'gerente',
  'comercial',
  'financeiro',
  'operador_anuncios',
  'visualizacao',
]);

/**
 * Criação de usuário pelo painel. A senha vai para o Firebase Authentication
 * via Admin SDK — nunca gravar password/passwordHash em users/{uid}.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z
    .string()
    .min(8, 'A senha precisa ter ao menos 8 caracteres')
    .max(128),
  role: commercialRoleSchema,
  isActive: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  uid: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  role: commercialRoleSchema.optional(),
  isActive: z.boolean().optional(),
});

/* ─── Captação pública (/anuncie) ────────────────────────────────────────── */

/**
 * Formulário público de proposta. Gera apenas um lead — nunca cliente ou
 * contrato. Os limites são curtos de propósito, por ser entrada não autenticada.
 */
export const salesLeadSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  company: z.string().trim().max(160).default(''),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  phone: z.string().trim().min(8, 'Informe um telefone válido').max(20),
  packageId: z.string().trim().min(1).nullable().default(null),
  durationMonths: packageDurationSchema.nullable().default(null),
  message: z.string().trim().max(1000).default(''),
});

/* ─── Tipos inferidos ────────────────────────────────────────────────────── */

export type PackageInput = z.infer<typeof packageSchema>;
export type PackageBenefitInput = z.infer<typeof packageBenefitSchema>;
export type PackageContentInput = z.infer<typeof packageContentSchema>;
export type ServiceCatalogInput = z.infer<typeof serviceCatalogSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
export type CloseContractInput = z.infer<typeof closeContractSchema>;
export type CancelContractInput = z.infer<typeof cancelContractSchema>;
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;
export type AssignAdInput = z.infer<typeof assignAdSchema>;
export type UpdateClientAdStatusInput = z.infer<typeof updateClientAdStatusSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type SalesLeadInput = z.infer<typeof salesLeadSchema>;

/* ─── Utilitário de erro ─────────────────────────────────────────────────── */

/**
 * Converte um ZodError em { campo: mensagem }, formato direto para exibir
 * abaixo de cada input do formulário e para devolver como 400 na API.
 */
export function formatZodErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
