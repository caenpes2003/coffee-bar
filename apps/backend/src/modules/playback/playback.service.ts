import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

type QueueRecord = Prisma.QueueItemGetPayload<{
  include: { song: true; table: true };
}>;

type PlaybackRecord = Prisma.PlaybackStateGetPayload<{
  include: {
    queue_item: {
      include: {
        song: true;
        table: true;
      };
    };
  };
}>;

/** Max seconds to wait in buffering before auto-recovering to playing */
const BUFFERING_TIMEOUT_SECONDS = 30;

@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async setPaused() {
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "paused",
        queue_item_id: null,
        started_at: null,
        position_seconds: null,
      },
      create: {
        id: 1,
        status: "paused",
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    const serialized = this.serializePlaybackState(state);
    this.realtimeGateway.emitPlaybackUpdated(serialized);
    return serialized;
  }

  async setIdle() {
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "idle",
        queue_item_id: null,
        started_at: null,
        position_seconds: null,
      },
      create: {
        id: 1,
        status: "idle",
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    const serialized = this.serializePlaybackState(state);
    this.realtimeGateway.emitPlaybackUpdated(serialized);
    return serialized;
  }

  async setBuffering(item: QueueRecord) {
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "buffering",
        queue_item_id: item.id,
        started_at: null,
        position_seconds: 0,
      },
      create: {
        id: 1,
        status: "buffering",
        queue_item_id: item.id,
        started_at: null,
        position_seconds: 0,
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    const serialized = this.serializePlaybackState(state);
    this.realtimeGateway.emitPlaybackUpdated(serialized);
    return serialized;
  }

  async setPlaying() {
    const state = await this.prisma.playbackState.update({
      where: { id: 1 },
      data: {
        status: "playing",
        started_at: new Date(),
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    const serialized = this.serializePlaybackState(state);
    this.realtimeGateway.emitPlaybackUpdated(serialized);
    return serialized;
  }

  async setFromQueueItem(item: QueueRecord) {
    const startedAt = new Date();
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "playing",
        queue_item_id: item.id,
        started_at: startedAt,
        position_seconds: 0,
      },
      create: {
        id: 1,
        status: "playing",
        queue_item_id: item.id,
        started_at: startedAt,
        position_seconds: 0,
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    const serialized = this.serializePlaybackState(state);
    this.realtimeGateway.emitPlaybackUpdated(serialized);
    return serialized;
  }

  async updateProgress(positionSeconds: number) {
    const state = await this.prisma.playbackState.update({
      where: { id: 1 },
      data: {
        position_seconds: Math.floor(positionSeconds),
      },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });
    return this.serializePlaybackState(state);
  }

  async getCurrent() {
    const state = await this.prisma.playbackState.findUnique({
      where: { id: 1 },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });

    if (!state) {
      return this.setIdle();
    }

    // Auto-recover: if stuck in buffering for too long, promote to playing
    if (
      state.status === "buffering" &&
      state.updated_at &&
      Date.now() - state.updated_at.getTime() >
        BUFFERING_TIMEOUT_SECONDS * 1000
    ) {
      return this.setPlaying();
    }

    return this.serializePlaybackState(state);
  }

  private serializePlaybackState(state: PlaybackRecord) {
    return {
      status: state.status,
      queue_item_id: state.queue_item_id,
      song: state.queue_item?.song ?? null,
      table_id: state.queue_item?.table_id ?? null,
      started_at: state.started_at?.toISOString() ?? null,
      updated_at: state.updated_at.toISOString(),
      position_seconds: state.position_seconds,
    };
  }
}
