import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { UserRole } from '../../common/enums';
import { CaptureTokenService } from './capture-token.service';
import { CaptureTokenDto } from './dto/visit.dto';

@ApiTags(SWAGGER_TAG.VISITS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.VISITS)
export class VisitsController {
  constructor(private readonly captureTokens: CaptureTokenService) {}

  @Post('capture-token')
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the 10-minute photo window',
    description:
      'Call when the camera opens (and again on every retake). Send the token with the door-to-door follow-up; it must arrive within 10 minutes, measured on the server clock.',
  })
  @ApiOkEnvelope(CaptureTokenDto)
  issue(@CurrentUser() user: AuthenticatedUser): CaptureTokenDto {
    return this.captureTokens.issue(user.id);
  }
}
