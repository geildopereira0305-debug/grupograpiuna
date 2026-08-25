/**
 * Acesso server-side ao Firebase (Admin SDK).
 *
 * Uso EXCLUSIVO nas rotas de api/. Nunca importar este arquivo em componentes
 * React: a chave privada iria para o bundle do navegador. Pelo mesmo motivo,
 * nenhuma destas variáveis pode ter o prefixo VITE_.
 *
 * Variáveis de ambiente esperadas (Vercel → Settings → Environment Variables):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY    (com \n escapados)
 *   FIREBASE_DATABASE_ID    (opcional — ver DEFAULT_DATABASE_ID abaixo)
 *
 * ATENÇÃO — Security Rules: o Admin SDK IGNORA as regras do Firestore. Toda
 * rota que usar `adminDb` precisa validar o token e o papel do usuário antes de
 * escrever; instalar o SDK não é, por si só, uma autorização.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

/**
 * Este projeto usa uma instância NÃO PADRÃO do Firestore — a mesma configurada
 * em src/firebase.ts. Sem informar o databaseId, o Admin SDK conversa com o
 * banco "(default)", que está vazio, e as gravações somem sem erro aparente.
 */
const DEFAULT_DATABASE_ID = 'ai-studio-0154e963-dfef-44b7-90a1-038646e49104';

export class FirebaseAdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseAdminConfigError';
  }
}

/** Nome próprio evita colidir com o app default de outra dependência. */
const APP_NAME = 'grupograpiuna-admin';

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

/**
 * Normaliza a chave privada. Ao passar por variável de ambiente, as quebras de
 * linha viram a sequência literal \n; sem desfazer isso o SDK rejeita a chave.
 * Também remove aspas que alguns painéis adicionam ao redor do valor.
 */
function normalizePrivateKey(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim();
}

/** Diz se as credenciais estão presentes, sem lançar erro. */
export function isAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY,
  );
}

/**
 * Inicializa (uma única vez) o app administrativo.
 *
 * A inicialização é PREGUIÇOSA de propósito: fazê-la no topo do módulo faria a
 * função serverless falhar já na importação quando faltasse uma variável,
 * devolvendo FUNCTION_INVOCATION_FAILED em vez de um erro tratável.
 */
export function getAdminApp(): App {
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
    throw new FirebaseAdminConfigError(
      `Credenciais do Firebase Admin ausentes: ${missing.join(', ')}`,
    );
  }

  // Em lambdas reaproveitadas o app pode já existir de uma invocação anterior
  const existing = getApps().find((app) => app.name === APP_NAME);
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

/** Firestore administrativo, já apontado para o banco correto do projeto. */
export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const databaseId = process.env.FIREBASE_DATABASE_ID || DEFAULT_DATABASE_ID;
  cachedDb = getFirestore(getAdminApp(), databaseId);
  return cachedDb;
}

/** Firebase Authentication administrativo (criar usuários, verificar tokens). */
export function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getAdminApp());
  return cachedAuth;
}

/** Usuário autenticado, já resolvido com o papel gravado em users/{uid}. */
export interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  /** Papel lido de users/{uid}; 'user' quando o documento não existe. */
  role: string;
}

/**
 * Verifica o ID token do Firebase e devolve o usuário com seu papel.
 *
 * O papel vem do Firestore (users/{uid}), e não do token, porque é lá que o
 * projeto já mantém a autorização — o mesmo critério usado por useAuth.ts e
 * pelas Security Rules. Retorna null quando o token é ausente ou inválido.
 *
 * @param authorizationHeader conteúdo do header Authorization ("Bearer <token>")
 */
export async function verifyRequestUser(
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser | null> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const snap = await getAdminDb().collection('users').doc(decoded.uid).get();

    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      emailVerified: decoded.email_verified ?? false,
      role: (snap.exists ? (snap.data()?.role as string) : undefined) ?? 'user',
    };
  } catch {
    // Token expirado, assinatura inválida ou projeto divergente
    return null;
  }
}

/** Reexportados para as rotas não precisarem importar firebase-admin direto. */
export { FieldValue, Timestamp };
