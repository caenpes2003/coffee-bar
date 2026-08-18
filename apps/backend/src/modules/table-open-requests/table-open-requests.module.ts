import { Module } from "@nestjs/common";
import { AccessCodeModule } from "../access-code/access-code.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { CashRegisterModule } from "../cash-register/cash-register.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { TableSessionsModule } from "../table-sessions/table-sessions.module";
import { TableOpenRequestsController } from "./table-open-requests.controller";
import { TableOpenRequestsService } from "./table-open-requests.service";

@Module({
  imports: [
    AccessCodeModule,
    AuditLogModule,
    CashRegisterModule,
    RealtimeModule,
    TableSessionsModule,
  ],
  controllers: [TableOpenRequestsController],
  providers: [TableOpenRequestsService],
  exports: [TableOpenRequestsService],
})
export class TableOpenRequestsModule {}
