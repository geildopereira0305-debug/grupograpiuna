/**
 * Matriz de permissões por papel (seção 9 do guia).
 *
 * Fonte única usada pelo painel (para esconder o que o usuário não pode fazer)
 * e pelas rotas de api/ (para realmente bloquear). Esconder o botão não protege
 * o banco — as duas checagens são necessárias.
 *
 * Módulo puro: só importa tipos, para poder ser carregado também no servidor.
 */
import type { CommercialRole, Permission, UserRole } from './commercial-types';

const ALL_PERMISSIONS: Permission[] = [
  'packages.read', 'packages.write',
  'clients.read', 'clients.write',
  'contracts.read', 'contracts.create', 'contracts.cancel',
  'finance.read', 'finance.write', 'finance.refund',
  'ads.read', 'ads.write', 'ads.approve', 'ads.publish',
  'users.read', 'users.write',
  'reports.read',
];

/**
 * Permissões por papel, transcritas da tabela do guia.
 *
 * Dois recortes que costumam passar despercebidos e estão explícitos aqui:
 * o Operador de anúncios NÃO lê valores financeiros, e o Financeiro NÃO opera
 * anúncios. O estorno (finance.refund) é exclusivo do administrador.
 */
export const ROLE_PERMISSIONS: Record<CommercialRole, Permission[]> = {
  admin: ALL_PERMISSIONS,

  gerente: [
    'packages.read', 'packages.write',
    'clients.read', 'clients.write',
    'contracts.read', 'contracts.create', 'contracts.cancel',
    'finance.read',
    'ads.read', 'ads.approve',
    'users.read',
    'reports.read',
  ],

  comercial: [
    'packages.read',
    'clients.read', 'clients.write',
    'contracts.read', 'contracts.create',
    'finance.read',
    'ads.read',
    'reports.read',
  ],

  financeiro: [
    'packages.read',
    'clients.read',
    'contracts.read',
    'finance.read', 'finance.write',
    'reports.read',
  ],

  operador_anuncios: [
    'packages.read',
    'clients.read',
    'contracts.read',
    'ads.read', 'ads.write', 'ads.publish',
    'reports.read',
  ],

  visualizacao: [
    'packages.read',
    'clients.read',
    'contracts.read',
    'finance.read',
    'ads.read',
    'reports.read',
  ],
};

/**
 * Converte papéis legados do portal editorial. 'editor' vale como 'gerente'
 * durante a migração, conforme orienta o guia.
 */
export function normalizeRole(role: UserRole | string | null | undefined): CommercialRole | null {
  if (!role) return null;
  if (role === 'editor') return 'gerente';
  if (role in ROLE_PERMISSIONS) return role as CommercialRole;
  return null;
}

/** O papel possui a permissão? */
export function can(
  role: UserRole | string | null | undefined,
  permission: Permission,
): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  return ROLE_PERMISSIONS[normalized].includes(permission);
}

/** Todas as permissões do papel — útil para montar menus de uma vez só. */
export function permissionsFor(role: UserRole | string | null | undefined): Permission[] {
  const normalized = normalizeRole(role);
  return normalized ? [...ROLE_PERMISSIONS[normalized]] : [];
}

/** Rótulos para exibição no painel. */
export const ROLE_LABELS: Record<CommercialRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  comercial: 'Comercial',
  financeiro: 'Financeiro',
  operador_anuncios: 'Operador de anúncios',
  visualizacao: 'Visualização',
};
