/**
 * Vercel Serverless Function — POST /api/commercial/close-contract
 *
 * Fecha um contrato numa única transação atômica: contrato + parcelas +
 * contadores de cota + auditoria. Ou tudo é gravado, ou nada é.
 *
 * Por que o fechamento NÃO acontece no React (seção 6 do guia):
 *  - o preço vem do documento do pacote lido AQUI, nunca do navegador;
 *  - o packageSnapshot precisa ser tirado no servidor, no instante da venda;
 *  - parcelas e cotas dependem de consistência entre vários documentos.
 *
 * Idempotência: a chave recebida vira um documento em commercial_requests.
 * Como ele é criado dentro da mesma transação, um clique duplo ou um F5 durante
 * a resposta devolve o contrato já criado em vez de duplicá-lo.
 */
import { FieldValue, getAdminDb, Timestamp } from '../_lib/firebase-admin';
import { requireAuth } from '../_lib/require-auth';
import {
  badRequest, conflict, created, methodNotAllowed, notFound, parseBody, serverError,
} from '../_lib/http';
import { closeContractSchema, formatZodErrors } from '../../src/lib/commercial-validation';
import {
  buildInstallmentPlan, computeContractPeriod, todayBusinessDate,
} from '../../src/lib/installment-dates';
import {
  AD_FORMATS, type AdFormat, type AdLimits, type PackageDuration,
} from '../../src/lib/commercial-types';

/** Coleção server-only: nenhuma regra a libera, então o cliente não a alcança. */
const REQUESTS = 'commercial_requests';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  // 1. Token e papel — antes de qualquer leitura ou gravação
  const user = await requireAuth(req, res, 'contracts.create');
  if (!user) return;

  // Payload validado com o mesmo schema usado no wizard
  const parsed = closeContractSchema.safeParse(parseBody(req));
  if (!parsed.success) {
    badRequest(res, 'Dados do contrato inválidos', formatZodErrors(parsed.error));
    return;
  }
  const input = parsed.data;

  try {
    const db = getAdminDb();

    const result = await db.runTransaction(async (tx) => {
      const requestRef = db.collection(REQUESTS).doc(input.idempotencyKey);
      const clientRef = db.collection('clients').doc(input.clientId);
      const packageRef = db.collection('packages').doc(input.packageId);

      // ── TODAS as leituras primeiro: o Firestore exige leituras antes de
      //    escritas dentro de uma transação.
      const [requestSnap, clientSnap, packageSnap, benefitsSnap, contentsSnap] =
        await Promise.all([
          tx.get(requestRef),
          tx.get(clientRef),
          tx.get(packageRef),
          tx.get(packageRef.collection('benefits').orderBy('order', 'asc')),
          tx.get(packageRef.collection('contents').orderBy('order', 'asc')),
        ]);

      // Chave já usada: devolve o contrato original, sem criar outro
      if (requestSnap.exists) {
        return {
          duplicated: true as const,
          contractId: requestSnap.data()?.contractId as string,
        };
      }

      // 2. Cliente precisa existir e estar ativo
      if (!clientSnap.exists) {
        return { failure: { status: 404, message: 'Cliente não encontrado' } };
      }
      const client = clientSnap.data() ?? {};
      if (client.status !== 'active') {
        return { failure: { status: 400, message: 'Cliente inativo não pode fechar contrato' } };
      }

      // 3. Pacote precisa existir, estar ativo e ter preço para a duração
      if (!packageSnap.exists) {
        return { failure: { status: 404, message: 'Pacote não encontrado' } };
      }
      const pkg = packageSnap.data() ?? {};
      if (pkg.isActive !== true) {
        return { failure: { status: 400, message: 'Pacote inativo não pode ser vendido' } };
      }

      const duration = input.durationMonths as PackageDuration;
      const subtotalCents = Number(pkg.prices?.[duration] ?? 0);
      if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
        return {
          failure: {
            status: 400,
            message: `O pacote não possui preço cadastrado para ${duration} ${duration === 1 ? 'mês' : 'meses'}`,
          },
        };
      }

      // 5. Totais — o desconto nunca pode zerar ou inverter o contrato
      const discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
      if (discountCents >= subtotalCents) {
        return {
          failure: { status: 400, message: 'O desconto não pode ser igual ou maior que o valor do pacote' },
        };
      }
      const totalCents = subtotalCents - discountCents;

      // 4. Snapshot: retrato do pacote NO MOMENTO da venda. Alterações futuras
      //    no catálogo não podem mudar retroativamente o que já foi vendido.
      const adLimits = AD_FORMATS.reduce((acc, format) => {
        acc[format] = Math.max(0, Math.floor(Number(pkg.adLimits?.[format] ?? 0)));
        return acc;
      }, {} as AdLimits);

      const packageSnapshot = {
        name: String(pkg.name ?? ''),
        color: String(pkg.color ?? '#B87333'),
        durationMonths: duration,
        priceCents: subtotalCents,
        benefits: benefitsSnap.docs
          .filter((d) => d.data().isActive !== false)
          .map((d) => String(d.data().label ?? '')),
        contents: contentsSnap.docs
          .filter((d) => d.data().isActive !== false)
          .map((d) => ({
            title: String(d.data().title ?? ''),
            type: String(d.data().type ?? 'outro'),
            description: String(d.data().description ?? ''),
            quantity: d.data().quantity ?? null,
          })),
        adLimits,
      };

      // 6. Calendário — função testada, que trata o último dia do mês
      const startDate = input.startDate ?? todayBusinessDate();
      const period = computeContractPeriod(startDate, duration);
      const plan = buildInstallmentPlan(totalCents, input.installmentCount, input.firstDueDate);

      // ── A partir daqui, somente gravações ──────────────────────────────
      const contractRef = db.collection('contracts').doc();
      const now = Timestamp.now();

      // 7. Contrato
      tx.set(contractRef, {
        clientId: input.clientId,
        packageId: input.packageId,
        packageSnapshot,
        durationMonths: duration,
        subtotalCents,
        discountCents,
        discountReason: input.discountReason ?? '',
        totalCents,
        installmentCount: input.installmentCount,
        firstDueDate: input.firstDueDate,
        startDate: period.startDate,
        endDate: period.endDate,
        sellerId: input.sellerId,
        paymentMethod: input.paymentMethod,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid,
        updatedBy: user.uid,
      });

      // 8. Parcelas (1 a 12), todas pendentes
      for (const installment of plan) {
        tx.set(db.collection('installments').doc(), {
          contractId: contractRef.id,
          clientId: input.clientId,
          number: installment.number,
          dueDate: installment.dueDate,
          amountCents: installment.amountCents,
          status: 'pending',
          paidCents: 0,
          paidAt: null,
          paymentMethod: null,
          updatedAt: now,
        });
      }

      // 9. Contadores de cota, um documento por formato
      for (const format of AD_FORMATS as readonly AdFormat[]) {
        tx.set(contractRef.collection('adUsage').doc(format), {
          format,
          limit: adLimits[format],
          used: 0,
          updatedAt: now,
        });
      }

      // 10. Auditoria
      tx.set(db.collection('activity_logs').doc(), {
        action: 'contract.create',
        userId: user.uid,
        userEmail: user.email,
        targets: {
          contractId: contractRef.id,
          clientId: input.clientId,
          packageId: input.packageId,
        },
        metadata: {
          durationMonths: duration,
          subtotalCents,
          discountCents,
          totalCents,
          installmentCount: input.installmentCount,
          firstDueDate: input.firstDueDate,
          sellerId: input.sellerId,
        },
        createdAt: now,
      });

      // Marca a chave como processada — dentro da transação, para que duas
      // requisições simultâneas nunca criem dois contratos.
      tx.set(requestRef, {
        contractId: contractRef.id,
        operation: 'close-contract',
        userId: user.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        duplicated: false as const,
        contractId: contractRef.id,
        totalCents,
        installments: plan,
        period,
        packageSnapshot,
      };
    });

    if ('failure' in result && result.failure) {
      const { status, message } = result.failure;
      if (status === 404) notFound(res, message);
      else badRequest(res, message);
      return;
    }

    if ('duplicated' in result && result.duplicated) {
      conflict(res, 'Este contrato já foi fechado', { contractId: result.contractId });
      return;
    }

    created(res, { ok: true, ...result });
  } catch (err) {
    serverError(res, err);
  }
}
