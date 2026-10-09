import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

import { COMMON_ERROR, ROUTE, SWAGGER_TAG } from '../../common/constants';
import { Public } from '../../common/decorators';

@ApiTags(SWAGGER_TAG.HEALTH)
@Controller(ROUTE.HEALTH)
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Liveness and database check',
    description: 'Answers 200 when the process is up and the database answers a trivial query.',
  })
  async check(): Promise<{ status: string; database: string; time: string }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException(COMMON_ERROR.SERVICE_BUSY);
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }
}
