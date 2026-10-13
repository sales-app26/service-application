import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  CoveringDto,
  LeaderboardDto,
  LeaderboardQueryDto,
  ProjectScopeQueryDto,
  RosterRowDto,
} from './dto/team.dto';
import { TeamService } from './team.service';

@ApiTags(SWAGGER_TAG.TEAM)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get(`${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/leaderboard`)
  @ApiOperation({
    summary: 'Project leaderboard',
    description:
      'Any active member of the project, or the Super Admin (`404` otherwise). Every active sales person and moderator in the project with conversions and follow-ups this Monday–Sunday week (default) or calendar month, India time — most conversions first, then follow-ups, then name. No revenue.',
  })
  @ApiOkEnvelope(LeaderboardDto)
  leaderboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardDto> {
    return this.teamService.leaderboard(actor, params.id, query.period);
  }

  @Get(`${ROUTE.TEAM}/roster`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Team roster',
    description:
      'Every active sales person and moderator in the caller’s active projects (a moderator: his own projects only), or in `projectId` (which must be his, else `404`), once each. Contact details, who is on leave, what is due, last activity; with `projectId` also their backup and target there. On leave last, then most overdue first, then by name.',
  })
  @ApiOkArrayEnvelope(RosterRowDto)
  roster(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ProjectScopeQueryDto,
  ): Promise<RosterRowDto[]> {
    return this.teamService.roster(actor, query.projectId);
  }

  @Get(`${ROUTE.ME}/covering`)
  @ApiTags(SWAGGER_TAG.ME, SWAGGER_TAG.LEAVES)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Who I am covering for today',
    description:
      'Owners on leave today whose backup in an active project is the caller, with their leave and how many of their open leads are due (today or overdue) and overdue. Open their leads with `GET /projects/:id/leads?coveringFor=<ownerId>`.',
  })
  @ApiOkArrayEnvelope(CoveringDto)
  covering(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ProjectScopeQueryDto,
  ): Promise<CoveringDto[]> {
    return this.teamService.covering(actor, query.projectId);
  }
}
