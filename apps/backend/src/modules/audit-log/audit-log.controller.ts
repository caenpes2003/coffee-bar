import { Controller, Get, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";

@Controller("audit-log")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  list(@Query("limit", new ParseIntPipe({ optional: true })) limit?: number) {
    return this.service.list(limit ?? 100);
  }
}
