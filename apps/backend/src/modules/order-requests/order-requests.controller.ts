import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { OrderRequestStatus } from "@prisma/client";
import { OrderRequestsService } from "./order-requests.service";
import { CreateOrderRequestDto } from "./dto/create-order-request.dto";
import { RejectOrderRequestDto } from "./dto/reject-order-request.dto";

@Controller("order-requests")
export class OrderRequestsController {
  constructor(private readonly service: OrderRequestsService) {}

  @Get()
  findAll(
    @Query("status") status?: OrderRequestStatus,
    @Query("table_session_id") tableSessionId?: string,
  ) {
    return this.service.findAll({
      status,
      tableSessionId: tableSessionId
        ? Number.parseInt(tableSessionId, 10)
        : undefined,
    });
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateOrderRequestDto) {
    const request = await this.service.create(dto);
    return this.service.serialize(request);
  }

  @Post(":id/accept")
  async accept(@Param("id", ParseIntPipe) id: number) {
    const request = await this.service.accept(id);
    return this.service.serialize(request);
  }

  @Post(":id/reject")
  async reject(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RejectOrderRequestDto,
  ) {
    const request = await this.service.reject(id, dto.reason);
    return this.service.serialize(request);
  }

  @Post(":id/cancel")
  async cancel(@Param("id", ParseIntPipe) id: number) {
    const request = await this.service.cancelByCustomer(id);
    return this.service.serialize(request);
  }
}
