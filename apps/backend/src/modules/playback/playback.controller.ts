import { Body, Controller, Get, Patch } from "@nestjs/common";
import { PlaybackService } from "./playback.service";

@Controller("playback")
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  @Get("current")
  getCurrent() {
    return this.playbackService.getCurrent();
  }

  @Patch("playing")
  setPlaying() {
    return this.playbackService.setPlaying();
  }

  @Patch("progress")
  updateProgress(@Body() body: { position_seconds: number }) {
    return this.playbackService.updateProgress(body.position_seconds);
  }
}
