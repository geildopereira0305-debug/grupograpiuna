/**
 * Respostas HTTP padronizadas das rotas comerciais.
 *
 * Operações comerciais NUNCA devem ser cacheadas: um contrato fechado ou uma
 * baixa registrada não podem ser servidos de cache da CDN. Por isso todo
 * `sendJson` marca a resposta como no-store.
 */

export interface ApiError {
  error: string;
  /** Erros por campo, no formato devolvido por formatZodErrors. */
  fields?: Record<string, string>;
  /** Código estável para o frontend reagir sem depender da mensagem. */
  code?: string;
}

export function sendJson(res: any, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(status).json(body);
}

export function ok(res: any, body: unknown): void {
  sendJson(res, 200, body);
}

export function created(res: any, body: unknown): void {
  sendJson(res, 201, body);
}

export function badRequest(
  res: any,
  error: string,
  fields?: Record<string, string>,
  code?: string,
): void {
  sendJson(res, 400, { error, ...(fields ? { fields } : {}), ...(code ? { code } : {}) });
}

export function unauthorized(res: any, error = 'Não autenticado'): void {
  sendJson(res, 401, { error, code: 'unauthenticated' });
}

export function forbidden(res: any, error = 'Sem permissão para esta operação'): void {
  sendJson(res, 403, { error, code: 'forbidden' });
}

export function notFound(res: any, error: string, code?: string): void {
  sendJson(res, 404, { error, ...(code ? { code } : {}) });
}

/** Usado quando a chave de idempotência já foi processada. */
export function conflict(res: any, error: string, extra?: Record<string, unknown>): void {
  sendJson(res, 409, { error, code: 'conflict', ...(extra ?? {}) });
}

export function methodNotAllowed(res: any, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: `Método não permitido. Use ${allowed.join(' ou ')}.` });
}

export function serverError(res: any, detail?: unknown): void {
  // Detalhe fica no log do servidor; o cliente recebe mensagem genérica
  if (detail) console.error('[api] erro interno:', detail);
  sendJson(res, 500, { error: 'Erro interno ao processar a operação', code: 'internal' });
}

/**
 * Body como objeto. Na Vercel o JSON já vem parseado; no Express local pode
 * chegar como string, dependendo do middleware registrado.
 */
export function parseBody(req: any): Record<string, unknown> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body as Record<string, unknown>;
}
