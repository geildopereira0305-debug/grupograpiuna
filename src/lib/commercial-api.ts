/**
 * Cliente HTTP das rotas de api/commercial.
 *
 * Toda operação comercial passa por aqui para anexar o ID token do Firebase —
 * é ele que o servidor valida antes de gravar. Sem token, a rota responde 401.
 */
import { auth } from '../firebase';

export class CommercialApiError extends Error {
  status: number;
  /** Erros por campo devolvidos pela validação Zod do servidor. */
  fields?: Record<string, string>;
  code?: string;
  /** Corpo completo — em 409, traz o contractId já existente. */
  payload?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    fields?: Record<string, string>,
    code?: string,
    payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommercialApiError';
    this.status = status;
    this.fields = fields;
    this.code = code;
    this.payload = payload;
  }
}

/**
 * POST autenticado. Lança CommercialApiError em qualquer resposta não-2xx,
 * preservando status, campos e código para a tela reagir adequadamente.
 */
export async function postCommercial<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new CommercialApiError('Sessão expirada. Entre novamente.', 401);
  }

  const token = await user.getIdToken();

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CommercialApiError('Falha de rede ao contatar o servidor', 0);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new CommercialApiError(
      (data.error as string) ?? 'Não foi possível concluir a operação',
      response.status,
      data.fields as Record<string, string> | undefined,
      data.code as string | undefined,
      data,
    );
  }

  return data as T;
}

/**
 * Chave de idempotência para operações que não podem duplicar.
 * Gerada UMA vez por tentativa e reaproveitada em reenvios, para que o
 * servidor reconheça o clique duplo em vez de criar um segundo contrato.
 */
export function newIdempotencyKey(prefix = 'req'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}
