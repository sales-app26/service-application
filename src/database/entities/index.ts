import { FollowUp } from './follow-up.entity';
import { LeadTransfer } from './lead-transfer.entity';
import { Lead } from './lead.entity';
import { Location } from './location.entity';
import { ProjectMember } from './project-member.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

export { FollowUp, Lead, LeadTransfer, Location, Project, ProjectMember, User };

/** The seven version-1 tables (DB Design §1), in dependency order. */
export const ALL_ENTITIES = [User, Project, ProjectMember, Location, Lead, FollowUp, LeadTransfer];
