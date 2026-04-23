import { AxiosError } from "axios";

type ApiErrorResponse = {
  message?: string;
  code?: string;
  statusCode?: number;
  retry_after_seconds?: number;
  product_id?: number;
  product_name?: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  QUEUE_DUPLICATE: "Esta cancion ya esta en la cola",
  QUEUE_RECENTLY_PLAYED: "Esta cancion sono hace poco. Intenta con otra",
  QUEUE_LIMIT_REACHED: "Has alcanzado el limite de canciones activas",
  SONG_TOO_LONG: "Esta cancion supera la duracion maxima permitida",
  SONG_INVALID_DURATION: "La duracion de la cancion no es valida",
  TABLE_NOT_ACTIVE: "La mesa no esta activa para agregar canciones",
  SEARCH_RATE_LIMITED:
    "Has hecho muchas busquedas seguidas. Intenta de nuevo en unos segundos",
  QUEUE_RATE_LIMITED:
    "Estas intentando demasiado rapido. Espera un momento e intentalo otra vez",
  RATE_LIMITED:
    "Estas intentando demasiado rapido. Espera un momento e intentalo otra vez",
  SEARCH_QUOTA_EXCEEDED:
    "El servicio de busqueda ha alcanzado su limite diario. Intenta mas tarde",
  SEARCH_UPSTREAM_ERROR:
    "El servicio de busqueda no esta disponible temporalmente",
  SEARCH_UNAVAILABLE:
    "El servicio de busqueda no esta disponible en este momento. Intenta de nuevo",
  STOCK_CONFLICT: "Producto sin disponibilidad",
  STOCK_INSUFFICIENT: "Producto sin disponibilidad",
  ORDER_REQUEST_RACE: "Esta solicitud ya fue procesada",
};

const STATUS_FALLBACKS: Record<number, string> = {
  429: "Demasiadas solicitudes. Intenta de nuevo en unos segundos",
  404: "No encontrado",
  500: "No pudimos completar la accion en este momento",
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;

    if (!error.response) {
      return "No hay conexion con el servidor. Intenta nuevamente";
    }

    if (
      (data?.code === "STOCK_CONFLICT" ||
        data?.code === "STOCK_INSUFFICIENT") &&
      data.product_name
    ) {
      return `${data.product_name} sin disponibilidad`;
    }

    if (data?.code && ERROR_MESSAGES[data.code]) {
      return ERROR_MESSAGES[data.code];
    }

    if (data?.message && typeof data.message === "string") {
      return data.message;
    }

    const status = error.response?.status;
    if (status && STATUS_FALLBACKS[status]) {
      return STATUS_FALLBACKS[status];
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "No pudimos completar la accion en este momento";
}

export function getErrorCode(error: unknown): string | null {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;
    return data?.code ?? null;
  }

  return null;
}
