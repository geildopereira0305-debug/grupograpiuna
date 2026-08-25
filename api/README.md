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
