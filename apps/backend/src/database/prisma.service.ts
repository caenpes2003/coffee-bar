import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Timeouts de transacciones interactivas ($transaction con
      // callback). Los defaults de Prisma (maxWait 2s / timeout 5s)
      // están pensados para BD local; en Railway cada query paga
      // latencia de red y las transacciones con varios pasos (marcar
      // entregado = un Consumption + outbox por producto + proyección)
      // rozaban los 5s bajo carga y reventaban con "Transaction
      // already closed" (incidente 2026-08-30, PATCH /orders/:id/status).
      //
      // 30s NO significa transacciones lentas de 30s: es el techo de
      // seguridad para que un pico de latencia no tumbe una operación
      // de servicio. Postgres resuelve los locks igual que siempre.
      transactionOptions: {
        maxWait: 10_000,
        timeout: 30_000,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
