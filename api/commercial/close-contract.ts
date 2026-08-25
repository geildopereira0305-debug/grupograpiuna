/**
 * Vercel Serverless Function — POST /api/commercial/close-contract
 *
 * ┌─ POR QUE ESTE ARQUIVO É AUTOCONTIDO ─────────────────────────────────────┐
 * │ O projeto declara "type": "module". A Vercel transpila cada rota de api/  │
 * │ para ESM SEM empacotar, e o Node ESM não resolve import relativo sem      │
 * │ extensão — além disso, arquivos fora de api/ (como src/lib/) nem chegam   │
 * │ à lambda. Qualquer `import './x'` aqui quebra em produção com             │
 * │ ERR_MODULE_NOT_FOUND, como já ocorreu.                                    │
 * │                                                                           │
 * │ Import de node_modules (zod, firebase-admin) funciona normalmente — só o  │
 * │ relativo é proibido. Por isso a lógica compartilhada está duplicada aqui. │
 * │                                                                           │
 * │ Para a duplicação da matemática financeira não divergir em silêncio, o    │
 * │ teste de paridade em scripts/parity-close-contract.ts compara estas       │
 * │ funções com src/lib/installment-dates.ts. Alterou uma? Rode o teste.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Fecha o contrato numa única transação: contrato + parcelas + cotas +
 * auditoria. O preço vem do documento do pacote lido AQUI, nunca do navegador,
 * e o packageSnapshot é tirado no servidor, no instante da venda.
 */
import crypto from 'node:crypto';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  FieldValue, getFirestore, Timestamp, type Firestore,
} from 'firebase-admin/firestore';
import { z } from 'zod';

/*
 * NOTA — por que NÃO importamos 'firebase-admin/auth':
 * firebase-admin/auth → jwks-rsa → jose@6, que é ESM puro. A Vercel compila
 * esta rota para CommonJS e o require() de um pacote ESM falha com
 * ERR_REQUIRE_ESM. Só os verificadores de token puxam essa cadeia:
 * firebase-admin/app e firebase-admin/firestore estão livres dela.
 *
 * Por isso o ID token é validado abaixo com o crypto nativo do Node, seguindo
 * o procedimento oficial do Firebase para bibliotecas JWT de terceiros. Isso
 * remove a dependência conflitante em vez de contorná-la.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. Firebase Admin
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Instância NÃO PADRÃO do Firestore, a mesma de src/firebase.ts. Sem o
 * databaseId o Admin SDK conversaria com o banco "(default)", que está vazio.
 */
const DEFAULT_DATABASE_ID = 'ai-studio-0154e963-dfef-44b7-90a1-038646e49104';
const APP_NAME = 'grupograpiuna-admin';

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

/** A chave privada chega com \n escapados; sem desfazer isso o SDK a rejeita. */
function normalizePrivateKey(raw: string): string {
  return raw.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
}

/**
 * Inicialização PREGUIÇOSA: fazê-la no topo do módulo faria a função falhar já
 * na importação quando faltasse uma variável, devolvendo FUNCTION_INVOCATION_FAILED
 * em vez de um erro tratável.
 */
function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  const missing = [
    !projectId && 'FIREBASE_PROJECT_ID',
    !clientEmail && 'FIREBASE_CLIENT_EMAIL',
    !privateKeyRaw && 'FIREBASE_PRIVATE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Credenciais do Firebase Admin ausentes: ${missing.join(', ')}`);
  }

  const existing = getApps().find((a) => a.name === APP_NAME);
  cachedApp =
    existing ??
    initializeApp(
      {
        credential: cert({
          projectId,
          clientEmail,
          privateKey: normalizePrivateKey(privateKeyRaw as string),
        }),
        projectId,
      },
      APP_NAME,
    );
  return cachedApp;
}

function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(
    getAdminApp(),
    process.env.FIREBASE_DATABASE_ID || DEFAULT_DATABASE_ID,
  );
  return cachedDb;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Verificação do ID token (crypto nativo — sem jose)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Certificados públicos do Google que assinam os ID tokens do Firebase. */
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

/**
 * Busca (e memoriza) os certificados do Google, respeitando o max-age do
 * Cache-Control. Sem cache, cada requisição faria uma chamada externa.
 */
async function getGoogleCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error(`Falha ao obter certificados do Google (${response.status})`);
  }
  const certs = (await response.json()) as Record<string, string>;

  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  certCache = { certs, expiresAt: Date.now() + maxAge * 1000 };
  return certs;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface DecodedIdToken {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Valida um ID token do Firebase: assinatura RS256 contra os certificados do
 * Google e todas as claims exigidas. Devolve null em QUALQUER falha — nunca
 * lança para o chamador confundir token inválido com erro de infraestrutura.
 *
 * @param nowSeconds injetável apenas para teste; em produção usa o relógio real.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  certsProvider: () => Promise<Record<string, string>> = getGoogleCerts,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<DecodedIdToken | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  // Exigir RS256 bloqueia os ataques clássicos de "alg: none" e de troca para
  // HS256, em que o atacante assinaria o token com a própria chave pública.
  if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

  const certs = await certsProvider();
  const publicCert = certs[header.kid];
  if (!publicCert) return null;

  // Assinatura conferida ANTES de qualquer claim ser considerada confiável
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  let signatureValid = false;
  try {
    signatureValid = verifier.verify(publicCert, base64UrlDecode(signatureB64));
  } catch {
    return null;
  }
  if (!signatureValid) return null;

  // Claims obrigatórias (documentação oficial do Firebase)
  const CLOCK_SKEW = 300; // 5 min de tolerância entre relógios
  if (payload?.aud !== projectId) return null;
  if (payload?.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof payload?.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload?.iat !== 'number' || payload.iat > nowSeconds + CLOCK_SKEW) return null;
  if (typeof payload?.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload?.auth_time === 'number' && payload.auth_time > nowSeconds + CLOCK_SKEW) return null;

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: payload.email_verified === true,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Papel do usuário
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Papéis que podem criar contrato — recorte de 'contracts.create' na matriz de
 * src/lib/permissions.ts (fonte canônica). 'editor' é o legado do portal, que
 * vale como 'gerente' durante a migração.
 */
const ROLES_CAN_CREATE_CONTRACT = ['admin', 'gerente', 'comercial', 'editor'];

interface AuthenticatedUser {
  uid: string;
  email: string;
  role: string;
}

/**
 * Valida o ID token e resolve o papel em users/{uid}.
 *
 * Indispensável: o Admin SDK IGNORA as Security Rules, então sem esta checagem
 * qualquer pessoa que descobrisse a URL poderia fechar contratos.
 */
async function verifyRequestUser(
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser | null> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente');

  const decoded = await verifyFirebaseIdToken(token, projectId);
  if (!decoded) return null;

  // O papel vem do Firestore, e não do token — mesmo critério já usado por
  // useAuth.ts e pelas Security Rules.
  const snap = await getAdminDb().collection('users').doc(decoded.uid).get();
  return {
    uid: decoded.uid,
    email: decoded.email,
    role: (snap.exists ? (snap.data()?.role as string) : undefined) ?? 'user',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Respostas HTTP — operação comercial nunca pode ser cacheada
   ═══════════════════════════════════════════════════════════════════════════ */

function sendJson(res: any, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(status).json(body);
}

/** Na Vercel o JSON já vem parseado; no Express local pode chegar como string. */
function parseBody(req: any): Record<string, unknown> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body as Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Calendário e rateio (espelha src/lib/installment-dates.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TIME_ZONE = 'America/Bahia';

const pad = (n: number): string => String(n).padStart(2, '0');
const parseDateParts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
};
const formatDateParts = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function todayBusinessDate(timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Soma meses preservando o dia, recortando no último dia do mês de destino.
 * 2026-01-31 + 1 mês = 2026-02-28; +2 meses volta a 2026-03-31, porque o
 * cálculo parte sempre da data original e nunca encadeia o recorte.
 */
export function addMonthsClamped(date: string, months: number): string {
  const { y, m, d } = parseDateParts(date);
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = ((totalMonths % 12) + 12) % 12 + 1;
  return formatDateParts(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDateParts(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function computeContractPeriod(
  startDate: string,
  durationMonths: number,
): { startDate: string; endDate: string } {
  return {
    startDate,
    endDate: addDays(addMonthsClamped(startDate, durationMonths), -1),
  };
}

/** Rateio cuja soma é EXATAMENTE o total; os centavos restantes vão às primeiras. */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.round(totalCents));
  const base = Math.floor(safeTotal / count);
  const remainder = safeTotal - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface PlannedInstallment {
  number: number;
  dueDate: string;
  amountCents: number;
}

export function buildInstallmentPlan(
  totalCents: number,
  count: number,
  firstDueDate: string,
): PlannedInstallment[] {
  const amounts = splitInstallments(totalCents, count);
  return amounts.map((amountCents, i) => ({
    number: i + 1,
    dueDate: addMonthsClamped(firstDueDate, i),
    amountCents,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Validação (espelha closeContractSchema de src/lib/commercial-validation.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

const AD_FORMATS = ['cover', 'leaderboard', 'intermediario', 'sidebar', 'mobile'] as const;
type AdFormat = (typeof AD_FORMATS)[number];

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((value) => {
    const { y, m, d } = parseDateParts(value);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= lastDayOfMonth(y, m);
  }, 'Data inexistente no calendário');

export const closeContractSchema = z
  .object({
    clientId: z.string().trim().min(1, 'Selecione o cliente'),
    packageId: z.string().trim().min(1, 'Selecione o pacote'),
    durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    installmentCount: z.number().int().min(1, 'Mínimo de 1 parcela').max(12, 'Máximo de 12 parcelas'),
    firstDueDate: businessDateSchema,
    startDate: businessDateSchema.optional(),
    paymentMethod: z.enum(['pix', 'boleto', 'cartao', 'dinheiro', 'transferencia', 'outro']),
    sellerId: z.string().trim().min(1, 'Informe o vendedor'),
    discountCents: z.number().int().nonnegative().default(0),
    discountReason: z.string().trim().max(300).default(''),
    idempotencyKey: z.string().trim().min(8, 'Chave de idempotência inválida').max(120),
  })
  .refine((c) => c.discountCents === 0 || c.discountReason.trim().length >= 3, {
    message: 'Informe o motivo do desconto',
    path: ['discountReason'],
  });

function formatZodErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. Handler
   ═══════════════════════════════════════════════════════════════════════════ */

/** Coleção server-only: nenhuma regra a libera, então o cliente não a alcança. */
const REQUESTS = 'commercial_requests';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Método não permitido. Use POST.' });
    return;
  }

  // 1. Token e papel — antes de qualquer leitura ou gravação
  let user: AuthenticatedUser | null;
  try {
    user = await verifyRequestUser(req?.headers?.authorization);
  } catch (err) {
    console.error('[close-contract] falha ao verificar token:', err);
    sendJson(res, 500, { error: 'Erro interno ao validar a sessão', code: 'internal' });
    return;
  }

  if (!user) {
    sendJson(res, 401, { error: 'Faça login novamente para continuar', code: 'unauthenticated' });
    return;
  }
  if (!ROLES_CAN_CREATE_CONTRACT.includes(user.role)) {
    sendJson(res, 403, {
      error: `Seu perfil (${user.role}) não pode fechar contratos`,
      code: 'forbidden',
    });
    return;
  }

  const parsed = closeContractSchema.safeParse(parseBody(req));
  if (!parsed.success) {
    sendJson(res, 400, {
      error: 'Dados do contrato inválidos',
      fields: formatZodErrors(parsed.error),
    });
    return;
  }
  const input = parsed.data;

  try {
    const db = getAdminDb();

    const result = await db.runTransaction(async (tx) => {
      const requestRef = db.collection(REQUESTS).doc(input.idempotencyKey);
      const clientRef = db.collection('clients').doc(input.clientId);
      const packageRef = db.collection('packages').doc(input.packageId);

      // TODAS as leituras primeiro — exigência do Firestore em transações
      const [requestSnap, clientSnap, packageSnap, benefitsSnap, contentsSnap] =
        await Promise.all([
          tx.get(requestRef),
          tx.get(clientRef),
          tx.get(packageRef),
          tx.get(packageRef.collection('benefits').orderBy('order', 'asc')),
          tx.get(packageRef.collection('contents').orderBy('order', 'asc')),
        ]);

      // Chave já usada: devolve o contrato original em vez de criar outro
      if (requestSnap.exists) {
        return { duplicated: true as const, contractId: requestSnap.data()?.contractId as string };
      }

      // 2. Cliente existe e está ativo
      if (!clientSnap.exists) {
        return { failure: { status: 404, message: 'Cliente não encontrado' } };
      }
      if ((clientSnap.data() ?? {}).status !== 'active') {
        return { failure: { status: 400, message: 'Cliente inativo não pode fechar contrato' } };
      }

      // 3. Pacote existe, está ativo e tem preço para a duração
      if (!packageSnap.exists) {
        return { failure: { status: 404, message: 'Pacote não encontrado' } };
      }
      const pkg = packageSnap.data() ?? {};
      if (pkg.isActive !== true) {
        return { failure: { status: 400, message: 'Pacote inativo não pode ser vendido' } };
      }

      const duration = input.durationMonths;
      const subtotalCents = Number(pkg.prices?.[duration] ?? 0);
      if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
        return {
          failure: {
            status: 400,
            message: `O pacote não possui preço cadastrado para ${duration} ${duration === 1 ? 'mês' : 'meses'}`,
          },
        };
      }

      // 5. Totais — desconto nunca zera nem inverte o contrato
      const discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
      if (discountCents >= subtotalCents) {
        return {
          failure: { status: 400, message: 'O desconto não pode ser igual ou maior que o valor do pacote' },
        };
      }
      const totalCents = subtotalCents - discountCents;

      // 4. Snapshot: retrato do pacote NO MOMENTO da venda
      const adLimits = AD_FORMATS.reduce((acc, format) => {
        acc[format] = Math.max(0, Math.floor(Number(pkg.adLimits?.[format] ?? 0)));
        return acc;
      }, {} as Record<AdFormat, number>);

      const packageSnapshot = {
        name: String(pkg.name ?? ''),
        color: String(pkg.color ?? '#B87333'),
        durationMonths: duration,
        priceCents: subtotalCents,
        benefits: benefitsSnap.docs
          .filter((d) => d.data().isActive !== false)
          .map((d) => String(d.data().label ?? '')),
        contents: contentsSnap.docs
          .filter((d) => d.data().isActive !== false)
          .map((d) => ({
            title: String(d.data().title ?? ''),
            type: String(d.data().type ?? 'outro'),
            description: String(d.data().description ?? ''),
            quantity: d.data().quantity ?? null,
          })),
        adLimits,
      };

      // 6. Calendário com tratamento de fim de mês
      const startDate = input.startDate ?? todayBusinessDate();
      const period = computeContractPeriod(startDate, duration);
      const plan = buildInstallmentPlan(totalCents, input.installmentCount, input.firstDueDate);

      // ── A partir daqui, somente gravações ──────────────────────────────
      const contractRef = db.collection('contracts').doc();
      const now = Timestamp.now();

      // 7. Contrato
      tx.set(contractRef, {
        clientId: input.clientId,
        packageId: input.packageId,
        packageSnapshot,
        durationMonths: duration,
        subtotalCents,
        discountCents,
        discountReason: input.discountReason ?? '',
        totalCents,
        installmentCount: input.installmentCount,
        firstDueDate: input.firstDueDate,
        startDate: period.startDate,
        endDate: period.endDate,
        sellerId: input.sellerId,
        paymentMethod: input.paymentMethod,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
        createdBy: user!.uid,
        updatedBy: user!.uid,
      });

      // 8. Parcelas, todas pendentes
      for (const installment of plan) {
        tx.set(db.collection('installments').doc(), {
          contractId: contractRef.id,
          clientId: input.clientId,
          number: installment.number,
          dueDate: installment.dueDate,
          amountCents: installment.amountCents,
          status: 'pending',
          paidCents: 0,
          paidAt: null,
          paymentMethod: null,
          updatedAt: now,
        });
      }

      // Semeia o resumo mensal: sem isto, a primeira baixa deixaria o saldo
      // pendente negativo. "Contratado" entra no mês de início da vigência;
      // "pendente" é distribuído pelo mês de vencimento de cada parcela.
      const summaries = db.collection('financial_summaries');
      const startPeriod = period.startDate.slice(0, 7);

      const pendingByPeriod = new Map<string, number>();
      for (const installment of plan) {
        const p = installment.dueDate.slice(0, 7);
        pendingByPeriod.set(p, (pendingByPeriod.get(p) ?? 0) + installment.amountCents);
      }

      // O mês de início pode coincidir com um mês de vencimento; nesse caso os
      // dois incrementos precisam ir num único set, senão um sobrescreve o outro.
      const startPending = pendingByPeriod.get(startPeriod) ?? 0;
      pendingByPeriod.delete(startPeriod);

      tx.set(
        summaries.doc(startPeriod),
        {
          period: startPeriod,
          contractedCents: FieldValue.increment(totalCents),
          contractCount: FieldValue.increment(1),
          ...(startPending > 0 ? { pendingCents: FieldValue.increment(startPending) } : {}),
          updatedAt: now,
        },
        { merge: true },
      );

      for (const [p, cents] of pendingByPeriod) {
        tx.set(
          summaries.doc(p),
          { period: p, pendingCents: FieldValue.increment(cents), updatedAt: now },
          { merge: true },
        );
      }

      // 9. Contadores de cota, um por formato
      for (const format of AD_FORMATS) {
        tx.set(contractRef.collection('adUsage').doc(format), {
          format,
          limit: adLimits[format],
          used: 0,
          updatedAt: now,
        });
      }

      // 10. Auditoria
      tx.set(db.collection('activity_logs').doc(), {
        action: 'contract.create',
        userId: user!.uid,
        userEmail: user!.email,
        targets: {
          contractId: contractRef.id,
          clientId: input.clientId,
          packageId: input.packageId,
        },
        metadata: {
          durationMonths: duration,
          subtotalCents,
          discountCents,
          totalCents,
          installmentCount: input.installmentCount,
          firstDueDate: input.firstDueDate,
          sellerId: input.sellerId,
        },
        createdAt: now,
      });

      // Marca a chave como processada DENTRO da transação, para que duas
      // requisições simultâneas nunca criem dois contratos.
      tx.set(requestRef, {
        contractId: contractRef.id,
        operation: 'close-contract',
        userId: user!.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        duplicated: false as const,
        contractId: contractRef.id,
        totalCents,
        installments: plan,
        period,
        packageSnapshot,
      };
    });

    if ('failure' in result && result.failure) {
      sendJson(res, result.failure.status, { error: result.failure.message });
      return;
    }
    if ('duplicated' in result && result.duplicated) {
      sendJson(res, 409, {
        error: 'Este contrato já foi fechado',
        code: 'conflict',
        contractId: result.contractId,
      });
      return;
    }

    sendJson(res, 201, { ok: true, ...result });
  } catch (err) {
    console.error('[close-contract] erro interno:', err);
    sendJson(res, 500, { error: 'Erro interno ao processar a operação', code: 'internal' });
  }
}
