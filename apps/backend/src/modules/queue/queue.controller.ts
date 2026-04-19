import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import { AdminQueueItemDto } from "./dto/admin-queue-item.dto";
import { QueueService } from "./queue.service";

@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("global")
  findGlobal() {
    return this.queueService.findGlobal();
  }

  @Get()
  findByTable(
    @Query("table_id", ParseIntPipe) tableId: number,
    @Query("include_history") includeHistory?: string,
  ) {
    return this.queueService.findByTable(tableId, includeHistory === "true");
  }

  @Get("current")
  getCurrentPlaying() {
    return this.queueService.getCurrentPlaying();
  }

  @Get("stats")
  getStats() {
    return this.queueService.getStats();
  }

  @Post()
  create(@Body() createQueueItemDto: CreateQueueItemDto) {
    return this.queueService.create(createQueueItemDto);
  }

  @Post("play-next")
  playNext() {
    return this.queueService.playNext();
  }

  @Post("finish-current")
  finishCurrent() {
    return this.queueService.finishCurrent();
  }

  @Post("next")
  advanceToNext() {
    return this.queueService.advanceToNext();
  }

  @Post("skip-and-advance")
  skipAndAdvance() {
    return this.queueService.skipAndAdvance();
  }

  @Post("admin")
  adminCreate(@Body() dto: AdminQueueItemDto) {
    return this.queueService.adminCreate(dto);
  }

  @Post("admin/play-now")
  adminPlayNow(@Body() dto: AdminQueueItemDto) {
    return this.queueService.adminPlayNow(dto);
  }

  @Patch(":id/skip")
  skip(@Param("id", ParseIntPipe) id: number) {
    return this.queueService.skip(id);
  }
}
