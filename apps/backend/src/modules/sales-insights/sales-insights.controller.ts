import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { SalesInsightsService } from "./sales-insights.service";

/**
 * Aggregated sales view for the admin. Backed by Consumption (the ledger),
 * never by OrderItem directly — see service comment.
 */
@Controller("admin/sales")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class SalesInsightsController {
  constructor(private readonly service: SalesInsightsService) {}

  @Get("insights")
  insights(
    @Query("day") day?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("top_limit") topLimit?: string,
  ) {
    return this.service.getInsights({
      day: day?.trim() || undefined,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      topLimit: topLimit ? parseIntStrict(topLimit, "top_limit") : undefined,
    });
  }

  /**
   * Histórico de ventas día-por-día de un producto.
   * Default: últimos 60 días. Acepta `from`/`to` para rango personalizado.
   */
  @Get("products/:id/history")
  productHistory(
    @Param("id", ParseIntPipe) id: number,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.getProductHistory({
      productId: id,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }
}

function parseIntStrict(value: string, field: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new BadRequestException({
      message: `Invalid \`${field}\` — must be an integer`,
      code: "SALES_INVALID_PARAM",
    });
  }
  return n;
}
