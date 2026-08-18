import { IsInt, IsOptional, IsPositive, IsString, Length } from "class-validator";

export class OpenSessionDto {
  @IsInt()
  @IsPositive()
  table_id!: number;

  /**
   * Código del bar (F3). Opcional SOLO por retrocompat de deploy: el
   * frontend nuevo abre vía /table-open-requests (que lo exige); este
   * endpoint lo valida cuando viene. Cuando la ventana de deploy pase,
   * endurecer con ACCESS_CODE_REQUIRED=true (ver controller).
   */
  @IsOptional()
  @IsString()
  @Length(4, 4)
  access_code?: string;
}
