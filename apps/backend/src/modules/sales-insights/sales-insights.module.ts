import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { SalesInsightsController } from "./sales-insights.controller";
import { SalesInsightsService } from "./sales-insights.service";

@Module({
  // ProductsModule exporta ProductAvailabilityService — usado para
  // mostrar `derived_stock` real de compuestos en el tab Productos
  // (en lugar del stock legacy 999).
  imports: [ProductsModule],
  controllers: [SalesInsightsController],
  providers: [SalesInsightsService],
  exports: [SalesInsightsService],
})
export class SalesInsightsModule {}
