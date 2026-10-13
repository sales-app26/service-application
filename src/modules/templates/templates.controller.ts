import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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
import { CreateTemplateDto, TemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { TemplatesService } from './templates.service';

@ApiTags(SWAGGER_TAG.TEMPLATES)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get(`${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/${ROUTE.TEMPLATES}`)
  @ApiOperation({
    summary: 'A project’s message templates',
    description:
      'Any member of the project, or the Super Admin (`404` otherwise). By `sort`, then label.',
  })
  @ApiOkArrayEnvelope(TemplateDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<TemplateDto[]> {
    return this.templatesService.list(actor, params.id);
  }

  @Post(`${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/${ROUTE.TEMPLATES}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.TEMPLATE_SAVED)
  @ApiOperation({
    summary: 'Add a message template (admin)',
    description:
      'An admin of the project. `{client}`, `{rep}` and `{business}` in the body are stored as written.',
  })
  @ApiCreatedEnvelope(TemplateDto)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateDto> {
    return this.templatesService.create(actor, params.id, dto);
  }

  @Patch(`${ROUTE.TEMPLATES}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.TEMPLATE_SAVED)
  @ApiOperation({ summary: 'Edit a message template (admin of its project)' })
  @ApiOkEnvelope(TemplateDto)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateDto> {
    return this.templatesService.update(actor, params.id, dto);
  }

  @Delete(`${ROUTE.TEMPLATES}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'Delete a message template (admin of its project)' })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.templatesService.remove(actor, params.id);
    return null;
  }
}
