import { Global, Module } from "@nestjs/common";
import { TableProjectionService } from "./table-projection.service";

@Global()
@Module({
  providers: [TableProjectionService],
  exports: [TableProjectionService],
})
export class TableProjectionModule {}
