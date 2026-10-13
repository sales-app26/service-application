import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

import { toNumber } from '../../../common/utils';

export class ReverseQueryDto {
  @ApiProperty({ minimum: -90, maximum: 90, example: 18.4966 })
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: 73.8993 })
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng: number;
}

export class PlaceNameDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The area: suburb, neighbourhood or locality.',
    example: 'Wanowrie',
  })
  area: string | null;

  @ApiProperty({
    description: 'One short readable line. © OpenStreetMap contributors.',
    example: 'Wanowrie Road, Wanowrie, Pune 411040',
  })
  label: string;
}
