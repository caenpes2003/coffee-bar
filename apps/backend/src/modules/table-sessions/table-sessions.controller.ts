import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { TableSessionsService } from "./table-sessions.service";
import { OpenSessionDto } from "./dto/open-session.dto";

@Controller()
export class TableSessionsController {
  constructor(private readonly sessions: TableSessionsService) {}

  @Post("table-sessions/open")
  async open(@Body() dto: OpenSessionDto) {
    const session = await this.sessions.open(dto.table_id);
    return this.sessions.serialize(session);
  }

  @Post("table-sessions/:id/close")
  async close(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.close(id);
    return this.sessions.serialize(session);
  }

  @Get("table-sessions/:id")
  async getById(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.getById(id);
    return this.sessions.serialize(session);
  }

  @Get("tables/:id/session/current")
  async currentForTable(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.getCurrentForTable(id);
    if (!session) {
      throw new NotFoundException({
        message: `Table ${id} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    return this.sessions.serialize(session);
  }
}
