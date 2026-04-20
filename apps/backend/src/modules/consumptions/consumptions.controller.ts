import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { ConsumptionsService } from "./consumptions.service";
import { CreateAdjustmentDto } from "./dto/create-adjustment.dto";
import { RefundConsumptionDto } from "./dto/refund-consumption.dto";

@Controller()
export class ConsumptionsController {
  constructor(private readonly service: ConsumptionsService) {}

  @Get("bill/:sessionId")
  getBill(@Param("sessionId", ParseIntPipe) sessionId: number) {
    return this.service.getBill(sessionId);
  }

  @Post("bill/:sessionId/adjustments")
  async createAdjustment(
    @Param("sessionId", ParseIntPipe) sessionId: number,
    @Body() dto: CreateAdjustmentDto,
  ) {
    const created = await this.service.createAdjustment(sessionId, dto);
    return this.service.serialize(created);
  }

  @Post("consumptions/:id/refund")
  async refund(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RefundConsumptionDto,
  ) {
    const refund = await this.service.refundConsumption(id, dto);
    return this.service.serialize(refund);
  }
}
