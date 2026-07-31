import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Categorias editoriais das notícias. Fonte única — usada no formulário do
 * admin e nos filtros do portal, para as duas listas não divergirem.
 */
export const NEWS_CATEGORIES = [
  'Política',
  'Cidade',
  'Economia',
  'Polícia',
  'Violência',
  'Acidente',
  'Saúde',
  'Esporte',
  'Sul da Bahia',
  'Bahia',
  'Brasil',
  'Opinião',
] as const;

/**
 * Converte um texto em um slug seguro para URL.
 * `normalize("NFD")` decompõe os acentos em marcas combinantes, que em seguida
 * são descartadas pelo filtro que mantém apenas letras, números e hífens.
 */
export function slugify(text: string): string {
  return (text || "")
    .toString()
    .normalize("NFD") // decompõe acentos (í -> i + marca combinante)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // mantém só letras/números (remove marcas e símbolos)
    .replace(/\s+/g, "-") // espaços viram hífen
    .replace(/-+/g, "-") // colapsa hífens repetidos
    .replace(/^-+|-+$/g, ""); // remove hífens das pontas
}

/**
 * Monta o caminho legível de uma notícia no formato `/noticias/<slug>-<id>`.
 * O ID do Firestore (alfanumérico, sem hífens) fica no final para permitir
 * a busca pelo documento sem precisar de migração de schema.
 */
export function newsHref(title: string, id?: string): string {
  if (!id) return "/noticias";
  const slug = slugify(title);
  return slug ? `/noticias/${slug}-${id}` : `/noticias/${id}`;
}

/**
 * Extrai o ID do documento Firestore a partir do parâmetro da rota.
 * Aceita tanto o formato legível (`slug-id`) quanto o ID puro (links antigos).
 * Como os IDs automáticos do Firestore não contêm hífen, o ID é sempre o
 * último segmento após o último hífen.
 */
export function extractNewsId(param?: string): string {
  if (!param) return "";
  const idx = param.lastIndexOf("-");
  return idx === -1 ? param : param.slice(idx + 1);
}
