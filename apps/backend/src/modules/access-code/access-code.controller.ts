import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AccessCodeService } from "./access-code.service";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";
import { AuditLogService } from "../audit-log/audit-log.service";

/**
 * Two surfaces:
 *   - Public POST /access-code/validate — used by the customer device
 *     gate before opening a session. Rate-limited via the global
 *     middleware to slow down brute-force attempts.
 *   - Admin GET / POST rotate — used by the dashboard widget so staff
 *     can see the current code and refresh it on demand.
 */
@Controller("access-code")
export class AccessCodeController {
  constructor(
    private readonly service: AccessCodeService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Public. Returns whether the supplied 4-digit code matches today's
   * active one. We never echo the active code on this endpoint — only
   * yes/no. Brute force is bounded by the rate limit.
   */
  @Post("validate")
  async validate(@Body() body: { code: string }) {
    const ok = await this.service.validate(body?.code ?? "");
    if (!ok) {
      throw new BadRequestException({
        message: "Código incorrecto",
        code: "BAR_CODE_INVALID",
      });
    }
    return { ok: true };
  }

  /**
   * Admin: see the current code. Lazily generates one if there's no
   * active row, so the dashboard always has something to show.
   */
  @Get("current")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async current() {
    return this.service.getOrRotate();
  }

  private readonly logger = new Logger(AccessCodeController.name);

  /**
   * Display surface for the bar's TV/player screen.
   *
   * ANTES era público sin auth — con el backend expuesto a internet eso
   * significaba que cualquiera, desde cualquier lugar, podía leer el
   * código en claro (rotarlo no servía de nada: el atacante lo volvía a
   * leer). Ahora exige la clave de despliegue `PLAYER_DISPLAY_KEY`
   * (env), que viaja en la URL de la TV del bar (`?k=...`).
   *
   * Compat de deploy: si la env NO está seteada aún, se mantiene
   * público con warning en logs — así el deploy del backend no rompe la
   * TV antes de configurar la variable en Railway.
   */
  @Get("display")
  async display(@Query("k") key?: string) {
    const required = process.env.PLAYER_DISPLAY_KEY;
    if (!required) {
      this.logger.warn(
        "PLAYER_DISPLAY_KEY no configurada — /access-code/display sigue público. Configúrala y actualiza la URL de la TV.",
      );
      return this.service.getOrRotate();
    }
    if (key !== required) {
      throw new ForbiddenException({
        message: "Invalid display key",
        code: "DISPLAY_KEY_INVALID",
      });
    }
    return this.service.getOrRotate();
  }

  /**
   * Admin: force a rotation. Returns the freshly minted code.
   */
  @Post("rotate")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async rotate(@CurrentAuth() auth: AuthPayload) {
    const actor =
      auth.kind === "admin" ? `admin#${auth.sub}` : auth.kind;
    const result = await this.service.rotate(actor);
    if (auth.kind === "admin") {
      void this.audit.record({
        kind: "access_code_rotated",
        actor_id: auth.sub,
        actor_label: auth.name,
        new_code: result.code,
      });
    }
    return result;
  }
}
