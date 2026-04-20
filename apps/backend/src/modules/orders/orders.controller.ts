import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async findAll(
    @Query("status") status?: OrderStatus,
    @Query("table_session_id") tableSessionId?: string,
  ) {
    const orders = await this.ordersService.findAll({
      status,
      tableSessionId: tableSessionId
        ? Number.parseInt(tableSessionId, 10)
        : undefined,
    });
    return orders.map((o) => this.ordersService.serialize(o));
  }

  @Get(":id")
  async findOne(@Param("id", ParseIntPipe) id: number) {
    const order = await this.ordersService.findOne(id);
    return this.ordersService.serialize(order);
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.ordersService.updateStatus(id, dto.status);
    return this.ordersService.serialize(order);
  }
}
