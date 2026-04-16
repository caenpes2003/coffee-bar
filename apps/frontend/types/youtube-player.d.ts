declare module "youtube-player" {
  type PlayerEvent = {
    data?: number;
    target?: unknown;
  };

  type PlayerEventHandler = (event?: PlayerEvent) => void;

  type PlayerInstance = {
    destroy: () => Promise<void> | void;
    loadVideoById: (videoId: string) => Promise<void>;
    pauseVideo: () => Promise<void>;
    playVideo: () => Promise<void>;
    stopVideo: () => Promise<void>;
    on: (eventName: string, listener: PlayerEventHandler) => void;
  };

  type PlayerFactory = (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => PlayerInstance;

  const createYouTubePlayer: PlayerFactory;

  export default createYouTubePlayer;
}
