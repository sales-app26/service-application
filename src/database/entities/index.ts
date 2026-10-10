import { AppVersion, AppVersionView } from './app-version.entity';
import { FollowUp } from './follow-up.entity';
import { LeadTransfer } from './lead-transfer.entity';
import { Lead } from './lead.entity';
import { Location } from './location.entity';
import { ProjectMember } from './project-member.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

export {
  AppVersion,
  AppVersionView,
  FollowUp,
  Lead,
  LeadTransfer,
  Location,
  Project,
  ProjectMember,
  User,
};

/**
 * The seven version-1 tables (DB Design §1), in dependency order, then the
 * release-note tables added in `02_app_versions.sql`.
 */
export const ALL_ENTITIES = [
  User,
  Project,
  ProjectMember,
  Location,
  Lead,
  FollowUp,
  LeadTransfer,
  AppVersion,
  AppVersionView,
];
