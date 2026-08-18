import { IsInt, IsPositive, IsString, Length, Matches } from "class-validator";

/**
 * Solicitud de acceso del cliente vía QR. El código del bar se valida
 * SERVER-SIDE contra AccessCodeService — antes la validación era un
 * `if` en el navegador y cualquiera con el token del QR podía abrir
 * mesas desde su casa.
 */
export class CreateTableOpenRequestDto {
  @IsInt()
  @IsPositive()
  table_id!: number;

  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/, { message: "access_code must be 4 digits" })
  access_code!: string;
}
