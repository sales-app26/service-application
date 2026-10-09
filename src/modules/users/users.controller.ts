import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  ChangeEmailDto,
  ChangeRoleDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags(SWAGGER_TAG.USERS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
@Controller(ROUTE.USERS)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Super Admin: everyone. Moderator: sales persons only — all of them, so he can add one to his project — with `canManage` true for those he created or shares a project with.',
  })
  @ApiPaginatedEnvelope(UserDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResponseDto<UserDto>> {
    return this.usersService.list(actor, query);
  }

  @Get(ROUTE.ID_PARAM)
  @ApiOperation({ summary: 'Get one user' })
  @ApiOkEnvelope(UserDto)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<UserDto> {
    return this.usersService.findOne(actor, params.id);
  }

  @Post()
  @ResponseMessage(SUCCESS_MESSAGE.USER_CREATED)
  @ApiOperation({
    summary: 'Create a moderator or sales person',
    description: [
      'Super Admin creates moderators and sales persons; a moderator creates sales persons. The person receives an email to set a password.',
      '',
      'An email held by an **active** user → `409 CONFLICT`. Held by a **deactivated** user → `409 USER_DEACTIVATED_EXISTS` with `details.userId`, so the screen can offer to reactivate instead.',
    ].join('\n'),
  })
  @ApiCreatedEnvelope(UserDto)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto): Promise<UserDto> {
    return this.usersService.create(actor, dto);
  }

  @Patch(ROUTE.ID_PARAM)
  @ApiOperation({
    summary: 'Edit name or phone',
    description: 'Only people the caller may manage.',
  })
  @ApiOkEnvelope(UserDto)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.usersService.update(actor, params.id, dto);
  }

  @Post(`${ROUTE.ID_PARAM}/deactivate`)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.USER_DEACTIVATED)
  @ApiOperation({
    summary: 'Deactivate a user',
    description:
      'Refused for the only active Super Admin. The person is signed out on their next action. Their leads stay in their name, tagged "Owner inactive" for reassignment; pending transfers they requested or would receive are rejected with "User deactivated".',
  })
  @ApiOkEnvelope(UserDto)
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<UserDto> {
    return this.usersService.deactivate(actor, params.id);
  }

  @Post(`${ROUTE.ID_PARAM}/reactivate`)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.USER_REACTIVATED)
  @ApiOperation({ summary: 'Reactivate a user' })
  @ApiOkEnvelope(UserDto)
  reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<UserDto> {
    return this.usersService.reactivate(actor, params.id);
  }

  @Patch(`${ROUTE.ID_PARAM}/role`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Change a user’s role',
    description: 'Super Admin only. History stays under the same person.',
  })
  @ApiOkEnvelope(UserDto)
  changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: ChangeRoleDto,
  ): Promise<UserDto> {
    return this.usersService.changeRole(actor, params.id, dto);
  }

  @Patch(`${ROUTE.ID_PARAM}/email`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Change a user’s email',
    description: 'Super Admin only. The person signs in with the new email from then on.',
  })
  @ApiOkEnvelope(UserDto)
  changeEmail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: ChangeEmailDto,
  ): Promise<UserDto> {
    return this.usersService.changeEmail(actor, params.id, dto);
  }
}
