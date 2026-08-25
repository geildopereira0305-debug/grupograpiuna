/**
 * Testes da verificação de ID token do Firebase.
 *
 * Esta verificação substituiu firebase-admin/auth (que puxava jose, ESM puro,
 * incompatível com a compilação CommonJS da Vercel). Como é o ÚNICO portão de
 * autenticação da rota de fechamento de contrato, cada caminho de rejeição
 * precisa estar coberto — um falso positivo aqui deixaria qualquer pessoa
 * fechar contratos.
 *
 * Rode com:  npm run test:token
 */
import crypto from 'node:crypto';
import { verifyFirebaseIdToken } from '../api/commercial/close-contract';

const PROJECT_ID = 'gen-lang-client-0101136724';
const KID = 'chave-de-teste';
const NOW = 1_800_000_000; // relógio fixo, para o teste não depender da hora real

// Par de chaves do "Google" e um par de atacante, para o teste de chave trocada
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const googleCerts = async () => ({
  [KID]: google.publicKey.export({ type: 'spki', format: 'pem' }) as string,
});

const b64u = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64url');

function makeToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: crypto.KeyObject | null,
): string {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(payload));
  if (!key) return `${h}.${p}.`; // sem assinatura (ataque "alg: none")
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  return `${h}.${p}.${signer.sign(key).toString('base64url')}`;
}

const validHeader = { alg: 'RS256', kid: KID, typ: 'JWT' };
const validPayload = {
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  aud: PROJECT_ID,
  sub: 'uid-do-usuario',
  email: 'vendedor@grupograpiuna.com.br',
  email_verified: true,
  auth_time: NOW - 60,
  iat: NOW - 60,
  exp: NOW + 3600,
};

let failures = 0;

async function expectAccepted(label: string, token: string) {
  const result = await verifyFirebaseIdToken(token, PROJECT_ID, googleCerts, NOW);
  const ok = result !== null;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${ok ? ` (uid: ${result!.uid})` : ' — deveria ACEITAR'}`);
  if (!ok) failures++;
}

async function expectRejected(label: string, token: string) {
  const result = await verifyFirebaseIdToken(token, PROJECT_ID, googleCerts, NOW);
  const ok = result === null;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${ok ? '' : ' — DEVERIA REJEITAR (falha de segurança!)'}`);
  if (!ok) failures++;
}

/* ── Caminho feliz ───────────────────────────────────────────────────────── */
await expectAccepted('token válido', makeToken(validHeader, validPayload, google.privateKey));

/* ── Ataques de assinatura ───────────────────────────────────────────────── */
await expectRejected(
  'assinado por outra chave',
  makeToken(validHeader, validPayload, attacker.privateKey),
);
await expectRejected('alg: none (sem assinatura)', makeToken({ ...validHeader, alg: 'none' }, validPayload, null));
await expectRejected(
  'alg trocado para HS256',
  makeToken({ ...validHeader, alg: 'HS256' }, validPayload, google.privateKey),
);
await expectRejected('sem kid no cabeçalho', makeToken({ alg: 'RS256', typ: 'JWT' }, validPayload, google.privateKey));
await expectRejected(
  'kid desconhecido',
  makeToken({ ...validHeader, kid: 'kid-inexistente' }, validPayload, google.privateKey),
);

/* ── Adulteração do conteúdo ─────────────────────────────────────────────── */
{
  const valid = makeToken(validHeader, validPayload, google.privateKey);
  const [h, , s] = valid.split('.');
  const tampered = `${h}.${b64u(JSON.stringify({ ...validPayload, sub: 'uid-do-atacante' }))}.${s}`;
  await expectRejected('payload adulterado (troca de uid)', tampered);
}

/* ── Claims inválidas ────────────────────────────────────────────────────── */
await expectRejected(
  'audiência de outro projeto',
  makeToken(validHeader, { ...validPayload, aud: 'outro-projeto' }, google.privateKey),
);
await expectRejected(
  'emissor inválido',
  makeToken(validHeader, { ...validPayload, iss: 'https://malicioso.example.com' }, google.privateKey),
);
await expectRejected(
  'token expirado',
  makeToken(validHeader, { ...validPayload, exp: NOW - 1 }, google.privateKey),
);
await expectRejected(
  'iat no futuro além da tolerância',
  makeToken(validHeader, { ...validPayload, iat: NOW + 600 }, google.privateKey),
);
await expectRejected(
  'sub vazio',
  makeToken(validHeader, { ...validPayload, sub: '' }, google.privateKey),
);
await expectRejected(
  'sem exp',
  makeToken(validHeader, { ...validPayload, exp: undefined }, google.privateKey),
);

/* ── Formato ─────────────────────────────────────────────────────────────── */
await expectRejected('token com 2 partes', 'abc.def');
await expectRejected('string vazia', '');
await expectRejected('base64 inválido', 'nao.eh.jwt');

/* ── Tolerância de relógio (deve ACEITAR) ────────────────────────────────── */
await expectAccepted(
  'iat 2min à frente (dentro da tolerância)',
  makeToken(validHeader, { ...validPayload, iat: NOW + 120 }, google.privateKey),
);

console.log(
  failures === 0
    ? '\nTODOS OS TESTES DE TOKEN PASSARAM'
    : `\n${failures} FALHA(S) — NÃO PUBLIQUE ATÉ CORRIGIR`,
);
process.exit(failures === 0 ? 0 : 1);
