/**
 * Vercel Serverless Function — POST /api/commercial/register-payment
 *
 * ┌─ ARQUIVO AUTOCONTIDO POR EXIGÊNCIA DA VERCEL ────────────────────────────┐
 * │ Ver api/README.md. Resumo: import relativo quebra (ERR_MODULE_NOT_FOUND) │
 * │ e 'firebase-admin/auth' puxa jose@6 (ESM puro), que a compilação CommonJS│
 * │ da Vercel não consegue require (ERR_REQUIRE_ESM). Ambos já derrubaram    │
 * │ um deploy. Só node_modules livres de ESM puro podem ser importados.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Registra a baixa de uma parcela numa transação: cria o pagamento, atualiza
 * paidCents e status, move o resumo mensal e grava auditoria.
 *
 * A transação é o que impede duas baixas concorrentes sobre a mesma parcela —
 * sem ela, dois operadores simultâneos poderiam quitar duas vezes.
 */
import crypto from 'node:crypto';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  FieldValue, getFirestore, Timestamp, type Firestore,
} from 'firebase-admin/firestore';
import { z } from 'zod';

/* ═══════════════════════════════════════════════════════════════════════════
   1. Firebase Admin
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_DATABASE_ID = 'ai-studio-0154e963-dfef-44b7-90a1-038646e49104';
const APP_NAME = 'grupograpiuna-admin';

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

function normalizePrivateKey(raw: string): string {
  return raw.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
}

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
  cachedDb = getFirestore(getAdminApp(), process.env.FIREBASE_DATABASE_ID || DEFAULT_DATABASE_ID);
  return cachedDb;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Verificação do ID token (crypto nativo — sem jose)
   ═══════════════════════════════════════════════════════════════════════════ */

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGoogleCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) throw new Error(`Falha ao obter certificados do Google (${response.status})`);
  const certs = (await response.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  certCache = { certs, expiresAt: Date.now() + maxAge * 1000 };
  return certs;
}

const base64UrlDecode = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface DecodedIdToken {
  uid: string;
  email: string;
}

/** Idêntica à de close-contract.ts; coberta por scripts/test-token-verification.ts. */
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

  if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

  const certs = await certsProvider();
  const publicCert = certs[header.kid];
  if (!publicCert) return null;

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  let valid = false;
  try {
    valid = verifier.verify(publicCert, base64UrlDecode(signatureB64));
  } catch {
    return null;
  }
  if (!valid) return null;

  const CLOCK_SKEW = 300;
  if (payload?.aud !== projectId) return null;
  if (payload?.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof payload?.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload?.iat !== 'number' || payload.iat > nowSeconds + CLOCK_SKEW) return null;
  if (typeof payload?.sub !== 'string' || payload.sub.length === 0) return null;

  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Papel do usuário
   ═══════════════════════════════════════════════════════════════════════════ */

/** Recorte de 'finance.write' na matriz de src/lib/permissions.ts. */
const ROLES_CAN_WRITE_FINANCE = ['admin', 'financeiro'];

interface AuthenticatedUser {
  uid: string;
  email: string;
  role: string;
}

async function verifyRequestUser(
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser | null> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente');

  const decoded = await verifyFirebaseIdToken(token, projectId);
  if (!decoded) return null;

  const snap = await getAdminDb().collection('users').doc(decoded.uid).get();
  return {
    uid: decoded.uid,
    email: decoded.email,
    role: (snap.exists ? (snap.data()?.role as string) : undefined) ?? 'user',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

function sendJson(res: any, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(status).json(body);
}

function parseBody(req: any): Record<string, unknown> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body as Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Datas e validação
   ═══════════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TIME_ZONE = 'America/Bahia';

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function todayBusinessDate(timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Competência YYYY-MM extraída da data do pagamento. */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= lastDayOfMonth(y, m);
  }, 'Data inexistente no calendário');

export const registerPaymentSchema = z.object({
  installmentId: z.string().trim().min(1),
  amountCents: z.number().int().positive('O valor recebido deve ser maior que zero'),
  paidAt: businessDateSchema,
  method: z.enum(['pix', 'boleto', 'cartao', 'dinheiro', 'transferencia', 'outro']),
  reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(500).default(''),
  idempotencyKey: z.string().trim().min(8).max(120),
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
   6. Handler
   ═══════════════════════════════════════════════════════════════════════════ */

const REQUESTS = 'commercial_requests';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Método não permitido. Use POST.' });
    return;
  }

  let user: AuthenticatedUser | null;
  try {
    user = await verifyRequestUser(req?.headers?.authorization);
  } catch (err) {
    console.error('[register-payment] falha ao verificar token:', err);
    sendJson(res, 500, { error: 'Erro interno ao validar a sessão', code: 'internal' });
    return;
  }

  if (!user) {
    sendJson(res, 401, { error: 'Faça login novamente para continuar', code: 'unauthenticated' });
    return;
  }
  if (!ROLES_CAN_WRITE_FINANCE.includes(user.role)) {
    sendJson(res, 403, {
      error: `Seu perfil (${user.role}) não pode registrar baixas`,
      code: 'forbidden',
    });
    return;
  }

  const parsed = registerPaymentSchema.safeParse(parseBody(req));
  if (!parsed.success) {
    sendJson(res, 400, { error: 'Dados da baixa inválidos', fields: formatZodErrors(parsed.error) });
    return;
  }
  const input = parsed.data;

  try {
    const db = getAdminDb();
    const today = todayBusinessDate();

    const result = await db.runTransaction(async (tx) => {
      const requestRef = db.collection(REQUESTS).doc(input.idempotencyKey);
      const installmentRef = db.collection('installments').doc(input.installmentId);

      const [requestSnap, installmentSnap] = await Promise.all([
        tx.get(requestRef),
        tx.get(installmentRef),
      ]);

      if (requestSnap.exists) {
        return { duplicated: true as const, paymentId: requestSnap.data()?.paymentId as string };
      }
      if (!installmentSnap.exists) {
        return { failure: { status: 404, message: 'Parcela não encontrada' } };
      }

      const installment = installmentSnap.data() ?? {};
      if (installment.status === 'cancelled') {
        return { failure: { status: 400, message: 'Parcela cancelada não aceita baixa' } };
      }

      const amountCents = Number(installment.amountCents ?? 0);
      const alreadyPaid = Number(installment.paidCents ?? 0);
      const remaining = amountCents - alreadyPaid;

      if (remaining <= 0) {
        return { failure: { status: 400, message: 'Esta parcela já está quitada' } };
      }
      // Excesso não autorizado: a baixa nunca pode ultrapassar o saldo em aberto
      if (input.amountCents > remaining) {
        return {
          failure: {
            status: 400,
            message: `Valor acima do saldo em aberto (${(remaining / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`,
          },
        };
      }

      const newPaidCents = alreadyPaid + input.amountCents;
      const fullySettled = newPaidCents >= amountCents;
      // Pagamento parcial mantém a parcela em aberto; se o vencimento já passou,
      // ela aparece como atrasada até a quitação.
      const newStatus = fullySettled
        ? 'paid'
        : String(installment.dueDate ?? '') < today
          ? 'overdue'
          : 'pending';

      const now = Timestamp.now();
      const paymentRef = installmentRef.collection('payments').doc();

      tx.set(paymentRef, {
        amountCents: input.amountCents,
        paidAt: input.paidAt,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        registeredBy: user!.uid,
        createdAt: now,
      });

      tx.set(
        installmentRef,
        {
          paidCents: newPaidCents,
          status: newStatus,
          paidAt: fullySettled ? now : null,
          paymentMethod: input.method,
          updatedAt: now,
        },
        { merge: true },
      );

      // Resumo mensal, atualizado na MESMA transação.
      //
      // "Recebido" pertence ao mês do PAGAMENTO; "pendente" pertence ao mês do
      // VENCIMENTO. Separar os dois evita que uma parcela paga em atraso suma
      // do saldo do mês em que era devida.
      //
      // (O total atrasado não entra aqui: ele muda sozinho com o passar dos
      // dias, então não é incrementável — a tela o calcula por consulta.)
      const receivedPeriod = periodOf(input.paidAt);
      const duePeriod = periodOf(String(installment.dueDate ?? input.paidAt));
      const summaries = db.collection('financial_summaries');

      if (receivedPeriod === duePeriod) {
        // Mesmo mês: um único set, porque dois increments no mesmo documento
        // dentro da transação se sobrescreveriam.
        tx.set(
          summaries.doc(receivedPeriod),
          {
            period: receivedPeriod,
            receivedCents: FieldValue.increment(input.amountCents),
            pendingCents: FieldValue.increment(-input.amountCents),
            paymentCount: FieldValue.increment(1),
            updatedAt: now,
          },
          { merge: true },
        );
      } else {
        tx.set(
          summaries.doc(receivedPeriod),
          {
            period: receivedPeriod,
            receivedCents: FieldValue.increment(input.amountCents),
            paymentCount: FieldValue.increment(1),
            updatedAt: now,
          },
          { merge: true },
        );
        tx.set(
          summaries.doc(duePeriod),
          {
            period: duePeriod,
            pendingCents: FieldValue.increment(-input.amountCents),
            updatedAt: now,
          },
          { merge: true },
        );
      }

      tx.set(db.collection('activity_logs').doc(), {
        action: 'payment.register',
        userId: user!.uid,
        userEmail: user!.email,
        targets: {
          installmentId: input.installmentId,
          contractId: String(installment.contractId ?? ''),
          clientId: String(installment.clientId ?? ''),
          paymentId: paymentRef.id,
        },
        metadata: {
          amountCents: input.amountCents,
          paidAt: input.paidAt,
          method: input.method,
          reference: input.reference,
          previousPaidCents: alreadyPaid,
          newPaidCents,
          newStatus,
        },
        createdAt: now,
      });

      tx.set(requestRef, {
        paymentId: paymentRef.id,
        installmentId: input.installmentId,
        operation: 'register-payment',
        userId: user!.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        duplicated: false as const,
        paymentId: paymentRef.id,
        paidCents: newPaidCents,
        remainingCents: amountCents - newPaidCents,
        status: newStatus,
      };
    });

    if ('failure' in result && result.failure) {
      sendJson(res, result.failure.status, { error: result.failure.message });
      return;
    }
    if ('duplicated' in result && result.duplicated) {
      sendJson(res, 409, {
        error: 'Esta baixa já foi registrada',
        code: 'conflict',
        paymentId: result.paymentId,
      });
      return;
    }

    sendJson(res, 201, { ok: true, ...result });
  } catch (err) {
    console.error('[register-payment] erro interno:', err);
    sendJson(res, 500, { error: 'Erro interno ao processar a operação', code: 'internal' });
  }
}
