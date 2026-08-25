/**
 * Guarda de autenticação e autorização das rotas comerciais.
 *
 * O Admin SDK IGNORA as Security Rules — então, sem esta verificação, qualquer
 * pessoa que descobrisse a URL poderia fechar contratos. Toda rota de
 * api/commercial/ precisa passar por aqui ANTES de qualquer gravação.
 */
import { verifyRequestUser, type AuthenticatedUser } from './firebase-admin';
import { forbidden, unauthorized } from './http';
import { can } from '../../src/lib/permissions';
import type { Permission } from '../../src/lib/commercial-types';

export type { AuthenticatedUser };

/**
 * Valida o token, resolve o papel em users/{uid} e confere a permissão.
 * Já responde 401/403 quando falha — o handler só precisa parar se o retorno
 * for null.
 *
 * @example
 *   const user = await requireAuth(req, res, 'contracts.create');
 *   if (!user) return;
 */
export async function requireAuth(
  req: any,
  res: any,
  permission: Permission,
): Promise<AuthenticatedUser | null> {
  const user = await verifyRequestUser(req?.headers?.authorization);

  if (!user) {
    unauthorized(res, 'Faça login novamente para continuar');
    return null;
  }

  if (!can(user.role, permission)) {
    forbidden(res, `Seu perfil (${user.role}) não pode executar esta operação`);
    return null;
  }

  return user;
}
