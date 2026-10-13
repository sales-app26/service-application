import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import { PersonRefDto } from '../leads/dto/entry.dto';
import { CommentsService } from './comments.service';
import { CommentDto, CreateCommentDto, HelpRequestDto, UpdateCommentDto } from './dto/comment.dto';

const WHO_SEES =
  'Anyone who may open the lead — its owner, the project’s admins, the backup covering for the owner while he is on leave; everyone else gets `404`.';

@ApiTags(SWAGGER_TAG.COMMENTS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/${ROUTE.COMMENTS}`)
  @ApiOperation({ summary: 'A lead’s comments, oldest first', description: WHO_SEES })
  @ApiOkArrayEnvelope(CommentDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<CommentDto[]> {
    return this.commentsService.list(actor, params.id);
  }

  @Get(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/mentionable`)
  @ApiOperation({
    summary: 'Who the caller may mention on a lead',
    description:
      'The lead’s owner, the project’s active moderators, and the owner’s backup while covering — active people who can open the lead, never the caller.',
  })
  @ApiOkArrayEnvelope(PersonRefDto)
  mentionable(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<PersonRefDto[]> {
    return this.commentsService.mentionable(actor, params.id);
  }

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/${ROUTE.COMMENTS}`)
  @ResponseMessage(SUCCESS_MESSAGE.COMMENT_SAVED)
  @ApiOperation({
    summary: 'Comment on a lead',
    description: [
      WHO_SEES,
      '',
      '`mentionIds` must come from `GET /leads/:id/mentionable` (`400` otherwise); each is notified (`mention`). The owner is notified (`comment`) unless he wrote it or was mentioned. `pinned` is for the owner or an admin (`403`).',
      '',
      '`kind: "feedback"` is an admin’s note on one entry (`entryId` required, `403` for non-admins): it shows on that entry, and the entry’s author is notified (`feedback`). An `entryId` must be in this lead’s history (`400`). Refused in a closed project (`409 PROJECT_CLOSED`).',
    ].join('\n'),
  })
  @ApiCreatedEnvelope(CommentDto)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.commentsService.create(actor, params.id, dto);
  }

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/help`)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.HELP_REQUESTED)
  @ApiOperation({
    summary: 'Ask the project’s moderators for help on a lead',
    description:
      'The owner, or the backup covering for him. A `help` comment mentioning every active moderator of the project, each notified (`help_requested`), and shown on the dashboard until resolved. One open help request per lead (`409`).',
  })
  @ApiCreatedEnvelope(CommentDto)
  requestHelp(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: HelpRequestDto,
  ): Promise<CommentDto> {
    return this.commentsService.requestHelp(actor, params.id, dto);
  }

  @Patch(`${ROUTE.COMMENTS}/${ROUTE.ID_PARAM}`)
  @ResponseMessage(SUCCESS_MESSAGE.COMMENT_SAVED)
  @ApiOperation({
    summary: 'Edit or pin a comment',
    description:
      '`body`: the author only. `pinned`: the lead’s owner or an admin. The lead’s newest pinned comment is shown at the top of the lead.',
  })
  @ApiOkEnvelope(CommentDto)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentDto> {
    return this.commentsService.update(actor, params.id, dto);
  }

  @Delete(`${ROUTE.COMMENTS}/${ROUTE.ID_PARAM}`)
  @ResponseMessage(SUCCESS_MESSAGE.COMMENT_DELETED)
  @ApiOperation({ summary: 'Delete a comment (author or Super Admin)' })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.commentsService.remove(actor, params.id);
    return null;
  }

  @Post(`${ROUTE.COMMENTS}/${ROUTE.ID_PARAM}/resolve`)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.HELP_RESOLVED)
  @ApiOperation({
    summary: 'Resolve a help request',
    description:
      'An admin of the project, or whoever asked. The asker is notified (`help_resolved`) when someone else resolves it.',
  })
  @ApiOkEnvelope(CommentDto)
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<CommentDto> {
    return this.commentsService.resolve(actor, params.id);
  }
}
