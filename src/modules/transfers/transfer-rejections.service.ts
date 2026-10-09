import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { SQL_TABLE } from '../../common/constants';
import { TransferStatus } from '../../common/enums';

/** Which pending transfers a change makes impossible. */
export interface PendingTransferScope {
  /** Transfers where this person is the requesting owner or the recipient. */
  userId?: string;
  /** Limited to leads of this project. Alone: every pending transfer in it. */
  projectId?: string;
  /** Limited to these leads. */
  leadIds?: string[];
}

/**
 * Rejects pending transfers that can no longer happen, in the caller's
 * transaction, with the reason shown to the owner (PRD §5.2, §5.3, §5.4, §5.5,
 * §5.10):
 *
 *  - a requester or recipient is deactivated, or removed from the project;
 *  - the project is closed;
 *  - the lead is deleted, or an admin reassigns it directly.
 *
 * Lives on its own, with no module dependencies, because users, projects,
 * members and leads all need it and the transfers feature needs them.
 */
@Injectable()
export class TransferRejectionsService {
  async rejectPending(
    manager: EntityManager,
    scope: PendingTransferScope,
    actorId: string,
    reason: string,
  ): Promise<number> {
    const conditions: string[] = [`t.status = $1`];
    const parameters: unknown[] = [
      TransferStatus.PENDING,
      TransferStatus.REJECTED,
      actorId,
      reason,
    ];

    if (scope.userId) {
      parameters.push(scope.userId);
      const index = parameters.length;
      conditions.push(`(t.from_user_id = $${index} OR t.to_user_id = $${index})`);
    }
    if (scope.projectId) {
      parameters.push(scope.projectId);
      conditions.push(
        `EXISTS (SELECT 1 FROM ${SQL_TABLE.LEADS} l WHERE l.id = t.lead_id AND l.project_id = $${parameters.length})`,
      );
    }
    if (scope.leadIds) {
      if (scope.leadIds.length === 0) return 0;
      parameters.push(scope.leadIds);
      conditions.push(`t.lead_id = ANY($${parameters.length}::uuid[])`);
    }

    // An unscoped call would reject every pending transfer in the system.
    if (conditions.length === 1) {
      throw new Error('rejectPending needs a user, project or lead scope');
    }

    const [, affected] = (await manager.query(
      `UPDATE ${SQL_TABLE.LEAD_TRANSFERS} t
          SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
        WHERE ${conditions.join(' AND ')}`,
      parameters,
    )) as [unknown, number];

    return affected ?? 0;
  }
}
