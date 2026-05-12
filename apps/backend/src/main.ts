import "dotenv/config";
// Sentry instrumentation. MUST be the first import after dotenv — it
// monkey-patches HTTP / Express modules at load time. Importing later
// means those modules are already constructed and we miss traces.
import "./instrument";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Zona horaria operativa del bar. Todo el módulo de ventas (daily_breakdown,
 * hourly_breakdown, weekday_breakdown, formatDayKey) usa `new Date()` y
 * lee componentes locales (`getHours`, `getDate`, etc.). Si el proceso
 * Node corre en una TZ distinta, las ventas de la noche caen "al día
 * siguiente" y los picos por hora se desplazan.
 *
 * Estrategia: fallamos el startup si `TZ` no está fijada explícitamente.
 * Forzar al operador a setearla en su .env / deploy config es mejor que
 * dejar que un servidor UTC corrompa los reportes en silencio.
 *
 * Para cambiar de bar (digamos a México), basta cambiar este valor +
 * `TZ` en .env. Sin migración de datos: los timestamps en BD son TIMESTAMP
 * UTC y Node los lee en la TZ del proceso al hacer getHours/getDate.
 */
const EXPECTED_TZ = "America/Bogota";

function assertTimezone(): void {
  const envTz = process.env.TZ;
  const runtimeTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!envTz) {
    console.error(
      `\n[BOOT] ❌ process.env.TZ no está fijada.\n` +
        `         Esperada: ${EXPECTED_TZ}. Fijala en .env o en la config del host.\n` +
        `         Sin esto los reportes de ventas se desplazan 5 horas en hosts UTC.\n`,
    );
    process.exit(1);
  }

  if (envTz !== EXPECTED_TZ) {
    console.error(
      `\n[BOOT] ❌ process.env.TZ="${envTz}" no coincide con la esperada (${EXPECTED_TZ}).\n` +
        `         Si cambiaste el bar de país, actualizá EXPECTED_TZ en main.ts.\n`,
    );
    process.exit(1);
  }

  if (runtimeTz !== EXPECTED_TZ) {
    console.error(
      `\n[BOOT] ❌ Node resolvió la TZ como "${runtimeTz}" pero TZ=${envTz}.\n` +
        `         Esto suele significar que el SO ignora la variable.\n` +
        `         Verificá: docker container env, systemd unit, o host TZ.\n`,
    );
    process.exit(1);
  }

  console.log(`[BOOT] ✓ Timezone: ${runtimeTz}`);
}

async function bootstrap() {
  assertTimezone();

  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (
    process.env.FRONTEND_URLS ??
    process.env.FRONTEND_URL ??
    "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown fields silently — was already on.
      whitelist: true,
      // Reject the request entirely if there are unknown fields. This makes
      // forged client payloads (e.g. trying to inject created_by, role, or
      // other privileged fields the DTO does not declare) a 400 instead of a
      // silent strip, so they show up in monitoring.
      forbidNonWhitelisted: true,
      // Transform plain bodies into DTO instances + coerce primitives.
      transform: true,
    }),
  );

  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);

  console.log(`Backend running on http://localhost:${port}/api`);
}

void bootstrap();
