import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { ConsumptionsController } from "./consumptions.controller";
import { ConsumptionsService } from "./consumptions.service";

@Module({
  imports: [RealtimeModule],
  controllers: [ConsumptionsController],
  providers: [ConsumptionsService],
  exports: [ConsumptionsService],
})
export class ConsumptionsModule {}
