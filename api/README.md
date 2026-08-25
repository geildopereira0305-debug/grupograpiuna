# Rotas serverless (`api/`)

## ⚠️ Regra obrigatória: cada rota precisa ser AUTOCONTIDA

Este projeto declara `"type": "module"` no `package.json`. A Vercel transpila
cada arquivo de `api/` para ESM **sem empacotar**, e daí decorrem duas
limitações que já causaram falha em produção:

1. O Node ESM **não resolve import relativo sem extensão**
   (`import './x'` → `ERR_MODULE_NOT_FOUND`).
2. Arquivos fora de `api/` — como `src/lib/` — **não são enviados para a
   lambda**, então nem com a extensão correta seriam encontrados.

### O que pode e o que não pode

```ts
// ✅ PODE — dependências de node_modules são instaladas normalmente
import { z } from 'zod';
import { getFirestore } from 'firebase-admin/firestore';

// ❌ NÃO PODE — quebra em produção com ERR_MODULE_NOT_FOUND
import { algo } from './_lib/helper';
import { outro } from '../../src/lib/util';
```

Foi por isso que `api/_lib/` foi removido: um módulo compartilhado ali é
importável em desenvolvimento (o `tsx` resolve) mas falha na Vercel, criando um
erro que só aparece depois do deploy.

### Como verificar antes de publicar

Transpile a rota como a Vercel faz e tente carregá-la com o Node:

```bash
npx esbuild api/minha/rota.ts --format=esm --platform=node --outfile=.repro/rota.mjs
node -e "import('./.repro/rota.mjs').then(()=>console.log('OK')).catch(e=>console.log(e.code))"
```

Se aparecer `ERR_MODULE_NOT_FOUND`, existe import relativo a eliminar.

### Lógica duplicada

Quando uma rota precisa de lógica que também roda no frontend, a cópia é
inevitável. Nesse caso, escreva um **teste de paridade** que compare as duas
implementações — ver `scripts/parity-close-contract.ts`, executado por
`npm run test:parity`. Sem isso, as cópias divergem em silêncio e o usuário vê
um valor enquanto o banco grava outro.

---

## ⚠️ Segunda armadilha: pacotes ESM puros

Depois de resolver os imports relativos, um novo deploy falhou com:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../node_modules/jose/dist/webapi/index.js
```

Causa: `firebase-admin/auth` → `jwks-rsa` → `jose@6`, que é **ESM puro**. A Vercel
compilou a rota para CommonJS e o `require()` de um pacote ESM falha.

Note que os dois erros se contradizem — um deploy tratou a rota como ESM, o
outro como CommonJS. Por isso **cada rota deve funcionar nos dois formatos**.

### Regra prática

`firebase-admin/app` e `firebase-admin/firestore` estão livres de `jose`.
Quem puxa a cadeia são apenas os verificadores de token:

```
firebase-admin/lib/auth/token-verifier.js
firebase-admin/lib/app-check/token-verifier.js
firebase-admin/lib/phone-number-verification/token-verifier.js
```

Por isso o ID token é validado com o `crypto` nativo do Node (ver a seção 2 de
`close-contract.ts`), seguindo o procedimento oficial do Firebase para
bibliotecas JWT de terceiros. Os testes estão em
`scripts/test-token-verification.ts` (`npm run test:token`).

### Verificação obrigatória antes do deploy

```bash
# 1. Carrega nos DOIS formatos de módulo?
npx esbuild api/minha/rota.ts --format=esm --platform=node --outfile=.repro/r.mjs
npx esbuild api/minha/rota.ts --format=cjs --platform=node --outfile=.repro/r.cjs
node -e "import('./.repro/r.mjs').then(()=>console.log('ESM OK'))"
node -e "require('./.repro/r.cjs'); console.log('CJS OK')"

# 2. Nenhum pacote ESM puro no grafo?
npx esbuild api/minha/rota.ts --bundle --platform=node --format=cjs \
  --outfile=.repro/b.cjs --metafile=.repro/meta.json
node -e "const m=require('./.repro/meta.json');console.log(Object.keys(m.inputs).filter(i=>/node_modules[\\/]jose[\\/]/.test(i)).length)"
```
