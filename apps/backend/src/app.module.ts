import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { AuthModule } from "./modules/auth/auth.module";
import { ConsumptionsModule } from "./modules/consumptions/consumptions.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { OrderRequestsModule } from "./modules/order-requests/order-requests.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProductsModule } from "./modules/products/products.module";
import { QueueModule } from "./modules/queue/queue.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { SalesInsightsModule } from "./modules/sales-insights/sales-insights.module";
import { TableProjectionModule } from "./modules/table-projection/table-projection.module";
import { TableSessionsModule } from "./modules/table-sessions/table-sessions.module";
import { TablesModule } from "./modules/tables/tables.module";
import { MusicModule } from "./modules/music/music.module";
import { HousePlaylistModule } from "./modules/house-playlist/house-playlist.module";
import { AuditLogModule } from "./modules/audit-log/audit-log.module";
import { AccessCodeModule } from "./modules/access-code/access-code.module";
import { BarBalanceModule } from "./modules/bar-balance/bar-balance.module";
import { CashRegisterModule } from "./modules/cash-register/cash-register.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { ExtraIncomeModule } from "./modules/extra-income/extra-income.module";
import { LuggageModule } from "./modules/luggage/luggage.module";
import { OutboxModule } from "./modules/outbox/outbox.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { rateLimitMiddleware } from "./common/rate-limit.middleware";
import { loggingMiddleware } from "./common/logging.middleware";
import { PlaybackModule } from "./modules/playback/playback.module";

@Module({
  imports: [
    AuthModule,
    ConsumptionsModule,
    DatabaseModule,
    HealthModule,
    MusicModule,
    HousePlaylistModule,
    AuditLogModule,
    AccessCodeModule,
    OrderRequestsModule,
    OrdersModule,
    ProductsModule,
    QueueModule,
    RealtimeModule,
    PlaybackModule,
    SalesInsightsModule,
    TableProjectionModule,
    TableSessionsModule,
    TablesModule,
    ExtraIncomeModule,
    LuggageModule,
    OutboxModule,
    CashRegisterModule,
    PaymentsModule,
    ExpensesModule,
    BarBalanceModule,
  ],
  providers: [
    // SentryGlobalFilter forwards every uncaught exception to Sentry
    // before falling through to Nest's default exception handler. The
    // ignore-list lives in instrument.ts so 4xx noise doesn't reach the
    // dashboard.
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(loggingMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });

    consumer
      .apply(rateLimitMiddleware)
      .forRoutes(
        { path: "auth/login", method: RequestMethod.POST },
        { path: "queue", method: RequestMethod.ALL },
        { path: "orders", method: RequestMethod.ALL },
        { path: "order-requests", method: RequestMethod.ALL },
        { path: "music/search", method: RequestMethod.ALL },
        { path: "table-sessions/open", method: RequestMethod.POST },
        { path: "access-code/validate", method: RequestMethod.POST },
        { path: "auth/forgot-password", method: RequestMethod.POST },
        { path: "auth/reset-password", method: RequestMethod.POST },
        { path: "bill/:sessionId/adjustments", method: RequestMethod.POST },
        { path: "consumptions/:id/refund", method: RequestMethod.POST },
        // Cobros rápidos de baño/maletas — rate-limit para que un click
        // accidental largo no genere 50 registros.
        {
          path: "admin/extra-income/restroom",
          method: RequestMethod.POST,
        },
        {
          path: "admin/extra-income/manual",
          method: RequestMethod.POST,
        },
        { path: "admin/luggage", method: RequestMethod.POST },
        // Apertura/cierre de día contable. Aunque la unicidad la
        // garantiza el partial unique index a nivel BD, rate-limit
        // protege contra double-click del cajero al abrir/cerrar
        // (evita la avalancha de 409s en logs y la confusión UX).
        { path: "admin/cash-register/open", method: RequestMethod.POST },
        { path: "admin/cash-register/close", method: RequestMethod.POST },
        // Gastos: rate-limit para que un click accidental largo no
        // genere 20 egresos duplicados.
        { path: "admin/expenses", method: RequestMethod.POST },
        // Saldo del bar: el POST exige un código de autorización de 4
        // dígitos — sin rate-limit sería fuerza-bruteable en segundos.
        { path: "admin/bar-balance", method: RequestMethod.POST },
      );
  }
}
