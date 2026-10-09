import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { PaginatedResponseDto, UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  BulkReassignDto,
  DecideTransferDto,
  ListTransfersQueryDto,
  PendingCountDto,
  ReassignResultDto,
  RequestTransferDto,
  TransferDto,
} from './dto/transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags(SWAGGER_TAG.TRANSFERS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/${ROUTE.TRANSFERS}`)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.TRANSFER_REQUESTED)
  @ApiOperation({
    summary: 'Request a transfer (owner)',
    description:
      'To another active member of the same project, with a reason. One pending request per lead (`409 TRANSFER_PENDING`: "A transfer is already waiting for approval."). The owner keeps working the lead while it waits.',
  })
  @ApiCreatedEnvelope(TransferDto)
  request(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: RequestTransferDto,
  ): Promise<TransferDto> {
    return this.transfersService.request(actor, params.id, dto);
  }

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/reassign`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.LEADS_REASSIGNED)
  @ApiOperation({
    summary: 'Reassign a lead directly (admin)',
    description:
      'Recorded as a transfer approved by the admin. The only way to move a lead whose owner is deactivated or removed. A pending request on it is rejected as superseded. A moderator cannot reassign to or from himself.',
  })
  @ApiOkEnvelope(ReassignResultDto)
  reassign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: RequestTransferDto,
  ): Promise<ReassignResultDto> {
    return this.transfersService.reassign(actor, params.id, dto);
  }

  @Post(`${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/${ROUTE.LEADS}/reassign`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.LEADS_REASSIGNED)
  @ApiOperation({
    summary: 'Reassign several leads to one member (admin)',
    description:
      'For a departed person’s leads. All or nothing; leads the recipient already owns are skipped and counted.',
  })
  @ApiOkEnvelope(ReassignResultDto)
  bulkReassign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: BulkReassignDto,
  ): Promise<ReassignResultDto> {
    return this.transfersService.bulkReassign(actor, params.id, dto);
  }

  @Get(ROUTE.TRANSFERS)
  @ApiOperation({
    summary: 'List transfers',
    description:
      'Admins: transfers in their projects, pending and decided. Sales persons: their own requests, with each decision and who made it.',
  })
  @ApiPaginatedEnvelope(TransferDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListTransfersQueryDto,
  ): Promise<PaginatedResponseDto<TransferDto>> {
    return this.transfersService.list(actor, query);
  }

  @Get(`${ROUTE.TRANSFERS}/pending-count`)
  @ApiOperation({ summary: 'Pending transfers in the caller’s scope — the menu badge' })
  @ApiOkEnvelope(PendingCountDto)
  pendingCount(@CurrentUser() actor: AuthenticatedUser): Promise<PendingCountDto> {
    return this.transfersService.pendingCount(actor);
  }

  @Get(`${ROUTE.TRANSFERS}/${ROUTE.ID_PARAM}`)
  @ApiOperation({ summary: 'Get one transfer' })
  @ApiOkEnvelope(TransferDto)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<TransferDto> {
    return this.transfersService.findOne(actor, params.id);
  }

  @Post(`${ROUTE.TRANSFERS}/${ROUTE.ID_PARAM}/approve`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.TRANSFER_APPROVED)
  @ApiOperation({
    summary: 'Approve a transfer',
    description:
      'The lead moves to the new owner; earlier entries keep their authors and the conversion credit stays put. A moderator cannot decide a request he made or would receive. If another admin decided first: `409 TRANSFER_ALREADY_DECIDED` ("Already decided by …").',
  })
  @ApiOkEnvelope(TransferDto)
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: DecideTransferDto,
  ): Promise<TransferDto> {
    return this.transfersService.approve(actor, params.id, dto);
  }

  @Post(`${ROUTE.TRANSFERS}/${ROUTE.ID_PARAM}/reject`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.TRANSFER_REJECTED)
  @ApiOperation({
    summary: 'Reject a transfer',
    description: 'The owner sees the decision and who made it, and can request again.',
  })
  @ApiOkEnvelope(TransferDto)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: DecideTransferDto,
  ): Promise<TransferDto> {
    return this.transfersService.reject(actor, params.id, dto);
  }
}
