import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TableSessionsController } from "./table-sessions.controller";
import { TableSessionsService } from "./table-sessions.service";

@Module({
  imports: [RealtimeModule],
  controllers: [TableSessionsController],
  providers: [TableSessionsService],
  exports: [TableSessionsService],
})
export class TableSessionsModule {}
