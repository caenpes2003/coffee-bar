import { AxiosError } from "axios";

type ApiErrorResponse = {
  message?: string;
  code?: string;
  statusCode?: number;
  retry_after_seconds?: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  QUEUE_DUPLICATE: "Esta canción ya está en la cola",
  QUEUE_RECENTLY_PLAYED: "Esta canción sonó hace poco. Intenta con otra",
  QUEUE_LIMIT_REACHED: "Has alcanzado el límite de canciones activas",
  SONG_TOO_LONG: "Esta canción supera la duración máxima permitida",
  SONG_INVALID_DURATION: "La duración de la canción no es válida",
  TABLE_NOT_ACTIVE: "La mesa no está activa para agregar canciones",
  SEARCH_RATE_LIMITED:
    "Has hecho muchas búsquedas seguidas. Intenta de nuevo en unos segundos",
  QUEUE_RATE_LIMITED:
    "Estás intentando demasiado rápido. Espera un momento e inténtalo otra vez",
  RATE_LIMITED:
    "Estás intentando demasiado rápido. Espera un momento e inténtalo otra vez",
  SEARCH_QUOTA_EXCEEDED:
    "El servicio de búsqueda ha alcanzado su límite diario. Intenta más tarde",
  SEARCH_UPSTREAM_ERROR:
    "El servicio de búsqueda no está disponible temporalmente",
  SEARCH_UNAVAILABLE:
    "El servicio de búsqueda no está disponible en este momento. Intenta de nuevo",
};

const STATUS_FALLBACKS: Record<number, string> = {
  429: "Demasiadas solicitudes. Intenta de nuevo en unos segundos",
  404: "No encontrado",
  500: "No pudimos completar la acción en este momento",
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;

    // Try error code mapping first
    if (data?.code && ERROR_MESSAGES[data.code]) {
      return ERROR_MESSAGES[data.code];
    }

    // Try backend message
    if (data?.message && typeof data.message === "string") {
      return data.message;
    }

    // Try status code fallback
    const status = error.response?.status;
    if (status && STATUS_FALLBACKS[status]) {
      return STATUS_FALLBACKS[status];
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "No pudimos completar la acción en este momento";
}

export function getErrorCode(error: unknown): string | null {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;
    return data?.code ?? null;
  }
  return null;
}
