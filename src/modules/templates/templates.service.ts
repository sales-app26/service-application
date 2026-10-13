import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ERROR_CODE, TEMPLATE_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import {
  BusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { MessageTemplate } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { CreateTemplateDto, TemplateDto, UpdateTemplateDto } from './dto/template.dto';

/**
 * Canned messages per project. Every member reads them; the project's admins
 * write them. A template in a project the caller cannot see is not found.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(MessageTemplate) private readonly templates: Repository<MessageTemplate>,
    private readonly access: ProjectAccessService,
  ) {}

  async list(actor: AuthenticatedUser, projectId: string): Promise<TemplateDto[]> {
    await this.access.assertCanView(actor, projectId);
    const rows = await this.templates
      .createQueryBuilder('t')
      .where('t.project_id = :projectId AND t.deleted_at IS NULL', { projectId })
      .orderBy('t.sort', 'ASC')
      .addOrderBy('lower(t.label)', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();
    return rows.map(toDto);
  }

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateTemplateDto,
  ): Promise<TemplateDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);

    const saved = await this.templates.save(
      this.templates.create({
        projectId,
        label: dto.label,
        body: dto.body,
        sort: dto.sort ?? 0,
        createdBy: actor.id,
      }),
    );
    return toDto(await this.templates.findOneByOrFail({ id: saved.id }));
  }

  async update(
    actor: AuthenticatedUser,
    templateId: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateDto> {
    if (dto.label === undefined && dto.body === undefined && dto.sort === undefined) {
      throw new BusinessException(TEMPLATE_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }
    const template = await this.findAdministered(actor, templateId);

    await this.templates.update(
      { id: template.id },
      {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      },
    );
    return toDto(await this.templates.findOneByOrFail({ id: template.id }));
  }

  async remove(actor: AuthenticatedUser, templateId: string): Promise<void> {
    const template = await this.findAdministered(actor, templateId);
    await this.templates.update(
      { id: template.id, deletedAt: IsNull() },
      { deletedAt: new Date() },
    );
  }

  /**
   * A live template in a project the caller administers. Anyone who cannot
   * see the project gets 404; a member who is not an admin gets 403.
   */
  private async findAdministered(
    actor: AuthenticatedUser,
    templateId: string,
  ): Promise<MessageTemplate> {
    const template = await this.templates.findOne({
      where: { id: templateId, deletedAt: IsNull() },
    });
    if (!template) {
      throw new NotFoundBusinessException(TEMPLATE_ERROR.NOT_FOUND);
    }
    try {
      await this.access.assertCanView(actor, template.projectId);
    } catch {
      throw new NotFoundBusinessException(TEMPLATE_ERROR.NOT_FOUND);
    }
    const project = await this.access.assertAdmin(actor, template.projectId);
    this.access.assertWritable(project);
    return template;
  }
}

const toDto = (row: MessageTemplate): TemplateDto => ({
  id: row.id,
  label: row.label,
  body: row.body,
  sort: row.sort,
});
