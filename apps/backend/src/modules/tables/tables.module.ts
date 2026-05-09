import { Module } from "@nestjs/common";
import { TableSessionsModule } from "../table-sessions/table-sessions.module";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";

@Module({
  imports: [TableSessionsModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
