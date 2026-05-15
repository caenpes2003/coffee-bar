import { Controller, Get } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductRecipesService } from "./product-recipes.service";

/**
 * Public catalog. Used by the customer cart on /mesa/:id and by anyone
 * else with internet access. Filters out inactive products so they cannot
 * be ordered.
 */
@Controller("products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly recipes: ProductRecipesService,
  ) {}

  @Get()
  findAll() {
    return this.productsService.findAllForCustomers();
  }

  /**
   * Recetas en bulk. Devuelve un mapeo `productId → slots[]` para
   * que el cart del cliente pueda renderizar selectores de mezcla
   * sin pedir uno por uno. Solo incluye productos compuestos
   * (los que tienen al menos un slot).
   *
   * Público: la composición no es información sensible, y la app
   * de mesa necesita poder mostrar el selector al pedir.
   */
  @Get("recipes")
  async getRecipesBulk() {
    return this.recipes.getBulkForCustomers();
  }
}
