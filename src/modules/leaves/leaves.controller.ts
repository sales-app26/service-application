import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkArrayEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { CreateLeaveDto, LeaveDto, ListLeavesQueryDto } from './dto/leave.dto';
import { LeavesService } from './leaves.service';

@ApiTags(SWAGGER_TAG.LEAVES)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.LEAVES)
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Post()
  @ResponseMessage(SUCCESS_MESSAGE.LEAVE_SAVED)
  @ApiOperation({
    summary: 'Book a leave',
    description: [
      'For yourself (no `userId`), or — for the Super Admin, or a moderator for a sales person he manages — for someone else (`403` otherwise).',
      '',
      'India dates, both included. The last day on or after the first and at most 60 days after it; the leave may have started before today only if it still covers today; it may start at most 365 days ahead (`400`). It may not overlap another of the person’s leaves (`409`).',
      '',
      'Each project backup of the person gets a `leave_cover` notification.',
    ].join('\n'),
  })
  @ApiCreatedEnvelope(LeaveDto)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateLeaveDto): Promise<LeaveDto> {
    return this.leavesService.create(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Current and upcoming leaves',
    description:
      'Not cancelled, ending today or later, soonest first. Sales persons: their own (another `userId` is `403`). Moderators: their own and the sales persons they manage (anyone else is `404`). Super Admin: everyone.',
  })
  @ApiOkArrayEnvelope(LeaveDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListLeavesQueryDto,
  ): Promise<LeaveDto[]> {
    return this.leavesService.list(actor, query);
  }

  @Delete(ROUTE.ID_PARAM)
  @ResponseMessage(SUCCESS_MESSAGE.LEAVE_CANCELLED)
  @ApiOperation({
    summary: 'Cancel a leave',
    description: 'The person himself, or whoever could have booked it for him. Kept as cancelled.',
  })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.leavesService.cancel(actor, params.id);
    return null;
  }
}
