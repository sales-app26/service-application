import { ApiProperty } from '@nestjs/swagger';

export class CaptureTokenDto {
  @ApiProperty({ description: 'Send back as `captureToken` with the follow-up form.' })
  captureToken: string;

  @ApiProperty()
  issuedAt: Date;

  @ApiProperty({ description: 'After this the photo must be retaken.' })
  expiresAt: Date;
}

export class PhotoUrlDto {
  @ApiProperty({ description: 'Short-lived signed URL. Ask again once it expires.' })
  url: string;

  @ApiProperty({ example: 600 })
  expiresInSeconds: number;
}
