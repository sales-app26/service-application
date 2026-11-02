import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

class PushKeysDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;
}

/** What the browser's `PushSubscription.toJSON()` gives, less what the API doesn't use. */
export class SubscribePushDto {
  @ApiProperty({ description: 'The push service address the browser was given.' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}

export class UnsubscribePushDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint: string;
}

export class PushKeyDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Null when push isn’t set up on the server; reminders stay inside the app.',
  })
  publicKey: string | null;
}
