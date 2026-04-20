import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConsumptionsModule } from "./modules/consumptions/consumptions.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { OrderRequestsModule } from "./modules/order-requests/order-requests.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProductsModule } from "./modules/products/products.module";
import { QueueModule } from "./modules/queue/queue.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { TableProjectionModule } from "./modules/table-projection/table-projection.module";
import { TableSessionsModule } from "./modules/table-sessions/table-sessions.module";
import { TablesModule } from "./modules/tables/tables.module";
import { MusicModule } from "./modules/music/music.module";
import { rateLimitMiddleware } from "./common/rate-limit.middleware";
import { loggingMiddleware } from "./common/logging.middleware";
import { PlaybackModule } from "./modules/playback/playback.module";

@Module({
  imports: [
    ConsumptionsModule,
    DatabaseModule,
    HealthModule,
    MusicModule,
    OrderRequestsModule,
    OrdersModule,
    ProductsModule,
    QueueModule,
    RealtimeModule,
    PlaybackModule,
    TableProjectionModule,
    TableSessionsModule,
    TablesModule,
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
        { path: "queue", method: RequestMethod.ALL },
        { path: "orders", method: RequestMethod.ALL },
        { path: "order-requests", method: RequestMethod.ALL },
        { path: "music/search", method: RequestMethod.ALL },
      );
  }
}
