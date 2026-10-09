import { Global, Module } from '@nestjs/common';

import { ImageService } from './image.service';

@Global()
@Module({
  providers: [ImageService],
  exports: [ImageService],
})
export class MediaModule {}
