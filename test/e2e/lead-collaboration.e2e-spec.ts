import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

/**
 * Team collaboration (`06_team_collaboration.sql`), lead side: comments, mentions,
 * feedback on entries, help requests, in-app notifications, handover notes and asking
 * for someone else's lead by phone — and that none of it reaches anyone who could not
 * open the lead.
 */
describe('Lead collaboration (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  const ids: Record<string, string> = {};
  const as: Record<string, ApiClient> = {};
  const projects: Record<string, string> = {};
  const today = istDate(new Date());
  let phone = 9876520000;
  let lead: any;

  const person = async (name: string, role: 'moderator' | 'sales_person') => {
    const key = name.split(' ')[0];
    const res = await admin.post('/users', {
      name,
      email: `${key.toLowerCase()}@pronttera.in`,
      role,
    });
    expect(res.status).toBe(201);
    ids[key] = res.body.data.id;
    as[key] = api.as(await harness.supabase.accessToken(ids[key]));
  };
  const project = async (key: string, members: string[]) => {
    const res = await admin.post('/projects', {
      name: key,
      type: 'online',
      startDate: '2026-01-01',
    });
    projects[key] = res.body.data.id;
    for (const m of members) {
      await admin.post(`/projects/${projects[key]}/members`, { userId: ids[m] });
    }
  };
  const addLead = async (client: ApiClient, fields: Record<string, unknown> = {}) => {
    const res = await client.post(`/projects/${projects.North}/leads`, {
      name: 'Asha Patil',
      businessName: 'Patil Sweets',
      phone: String((phone += 1)),
      location: 'Baner',
      status: 'contacted',
      note: 'Met the owner at the shop.',
      clientRequestId: requestId(),
      ...fields,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const addLeadRaw = (client: ApiClient, number: string) =>
    client.post(`/projects/${projects.North}/leads`, {
      name: 'Duplicate',
      businessName: 'Duplicate Stores',
      phone: number,
      location: 'Baner',
      status: 'contacted',
      note: 'Same number again.',
      clientRequestId: requestId(),
    });
  const inbox = async (client: ApiClient, kind?: string) => {
    const res = await client.get('/notifications?limit=100');
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<any>;
    return kind ? items.filter((n) => n.kind === kind) : items;
  };
  const comment = (client: ApiClient, leadId: string, body: Record<string, unknown>) =>
    client.post(`/leads/${leadId}/comments`, body);

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    await person('Meera Nair', 'moderator');
    await person('Omar Khan', 'moderator');
    await person('Farah Ali', 'moderator');
    await person('Ravi Kumar', 'sales_person');
    await person('Priya Desai', 'sales_person');
    await person('Sana Shaikh', 'sales_person');
    await project('North', ['Meera', 'Omar', 'Ravi', 'Priya']);
    await project('South', ['Farah', 'Sana']);
    // Notifications name a lead by its business.
    lead = await addLead(as.Ravi, { name: 'Anil Sharma', businessName: 'Sharma Stores' });
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ----------------------------------------------------------------- comments

  describe('comments', () => {
    let ravisComment: string;

    it('the owner comments; the list shows it with what the caller may do', async () => {
      const res = await comment(as.Ravi, lead.id, { body: '  Asked for a call back on Monday. ' });
      expect(res.status).toBe(201);
      ravisComment = res.body.data.id;
      expect(res.body.data).toMatchObject({
        kind: 'comment',
        body: 'Asked for a call back on Monday.',
        user: { id: ids.Ravi, name: 'Ravi Kumar' },
        mentions: [],
        pinned: false,
        entryId: null,
        resolvedAt: null,
        resolvedBy: null,
        editedAt: null,
        canEdit: true,
        canDelete: true,
        canPin: true,
        canResolve: false,
      });

      const asAdmin = (await as.Meera.get(`/leads/${lead.id}/comments`)).body.data;
      expect(asAdmin).toHaveLength(1);
      expect(asAdmin[0]).toMatchObject({ canEdit: false, canDelete: false, canPin: true });
    });

    it('nobody who cannot open the lead reads or writes its comments', async () => {
      for (const who of ['Priya', 'Sana', 'Farah']) {
        expect((await as[who].get(`/leads/${lead.id}/comments`)).status).toBe(404);
        expect((await comment(as[who], lead.id, { body: 'Hello' })).status).toBe(404);
        expect((await as[who].get(`/leads/${lead.id}/mentionable`)).status).toBe(404);
        expect((await as[who].patch(`/comments/${ravisComment}`, { body: 'Mine' })).status).toBe(
          404,
        );
        expect((await as[who].delete(`/comments/${ravisComment}`)).status).toBe(404);
      }
    });

    it('offers the owner and the project’s moderators to mention, never the caller', async () => {
      const ravis = (await as.Ravi.get(`/leads/${lead.id}/mentionable`)).body.data;
      expect(ravis).toEqual([
        { id: ids.Meera, name: 'Meera Nair' },
        { id: ids.Omar, name: 'Omar Khan' },
      ]);
      const meeras = (await as.Meera.get(`/leads/${lead.id}/mentionable`)).body.data;
      expect(meeras.map((p: any) => p.id)).toEqual([ids.Omar, ids.Ravi]);
    });

    it('refuses to mention anyone else', async () => {
      for (const who of ['Priya', 'Sana']) {
        const res = await comment(as.Ravi, lead.id, { body: 'Look', mentionIds: [ids[who]] });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      }
      expect((await inbox(as.Priya)).length).toBe(0);
    });

    it('notifies each mentioned person, and the owner of someone else’s comment', async () => {
      const long = `Can we offer the quarterly plan? ${'x'.repeat(300)}`;
      const res = await comment(as.Meera, lead.id, { body: long, mentionIds: [ids.Omar] });
      expect(res.status).toBe(201);
      expect(res.body.data.mentions).toEqual([{ id: ids.Omar, name: 'Omar Khan' }]);

      const [mention] = await inbox(as.Omar, 'mention');
      expect(mention).toMatchObject({
        title: 'Meera Nair mentioned you on Sharma Stores',
        body: long.slice(0, 140),
        link: `/leads/${lead.id}`,
        actor: { id: ids.Meera, name: 'Meera Nair' },
        leadId: lead.id,
        readAt: null,
      });
      const [owner] = await inbox(as.Ravi, 'comment');
      expect(owner).toMatchObject({
        title: 'Meera Nair left a note on Sharma Stores',
        link: `/leads/${lead.id}`,
      });
      // Never the author.
      expect(await inbox(as.Meera)).toEqual([]);
    });

    it('pins for the owner and admins; edits for the author only', async () => {
      const pinned = await as.Omar.patch(`/comments/${ravisComment}`, { pinned: true });
      expect(pinned.status).toBe(200);
      expect(pinned.body.data.pinned).toBe(true);
      expect((await as.Omar.patch(`/comments/${ravisComment}`, { body: 'Rewritten' })).status).toBe(
        403,
      );

      const edited = await as.Ravi.patch(`/comments/${ravisComment}`, { body: 'Call on Tuesday.' });
      expect(edited.status).toBe(200);
      expect(edited.body.data.editedAt).not.toBeNull();
      expect((await as.Ravi.patch(`/comments/${ravisComment}`, {})).status).toBe(400);

      const detail = (await as.Ravi.get(`/leads/${lead.id}`)).body.data;
      expect(detail.pinnedComment).toMatchObject({
        id: ravisComment,
        body: 'Call on Tuesday.',
        user: { id: ids.Ravi, name: 'Ravi Kumar' },
      });
      expect(detail.commentCount).toBe(2);
      expect(detail.openHelp).toBe(false);
    });

    it('deletes for the author or the Super Admin', async () => {
      const extra = (await comment(as.Ravi, lead.id, { body: 'Typo' })).body.data.id;
      expect((await as.Meera.delete(`/comments/${extra}`)).status).toBe(403);
      expect((await as.Ravi.delete(`/comments/${extra}`)).status).toBe(200);
      const other = (await comment(as.Ravi, lead.id, { body: 'Another' })).body.data.id;
      expect((await admin.delete(`/comments/${other}`)).status).toBe(200);
      expect((await as.Ravi.get(`/leads/${lead.id}`)).body.data.commentCount).toBe(2);
      expect((await as.Ravi.patch(`/comments/${other}`, { body: 'Back' })).status).toBe(404);
    });
  });

  // ----------------------------------------------------------------- feedback

  describe('feedback on an entry', () => {
    it('is for admins, about an entry on this lead', async () => {
      const entryId = lead.recentEntries[0].id;
      expect(
        (await comment(as.Ravi, lead.id, { kind: 'feedback', body: 'Self review', entryId }))
          .status,
      ).toBe(403);
      expect((await comment(as.Meera, lead.id, { kind: 'feedback', body: 'Nice' })).status).toBe(
        400,
      );
      const elsewhere = await addLead(as.Ravi);
      expect(
        (
          await comment(as.Meera, lead.id, {
            kind: 'feedback',
            body: 'Nice',
            entryId: elsewhere.recentEntries[0].id,
          })
        ).status,
      ).toBe(400);
    });

    it('shows on the entry everywhere and tells its author', async () => {
      const entryId = lead.recentEntries[0].id;
      const res = await comment(as.Meera, lead.id, {
        kind: 'feedback',
        body: 'Good first visit — ask for the shop photo next time.',
        entryId,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ kind: 'feedback', entryId });

      const [note] = await inbox(as.Ravi, 'feedback');
      expect(note).toMatchObject({
        title: 'Meera Nair left feedback on your follow-up with Sharma Stores',
        link: `/day?date=${today}`,
      });
      // The owner wrote the entry: one notification, not a second "comment" one.
      expect(await inbox(as.Ravi, 'comment')).toHaveLength(1);

      const expected = [
        expect.objectContaining({
          body: 'Good first visit — ask for the shop photo next time.',
          user: { id: ids.Meera, name: 'Meera Nair' },
        }),
      ];
      const detail = (await as.Ravi.get(`/leads/${lead.id}`)).body.data;
      expect(detail.recentEntries.find((e: any) => e.id === entryId).feedback).toEqual(expected);
      const entries = (await as.Ravi.get(`/leads/${lead.id}/entries`)).body.data.items;
      expect(entries.find((e: any) => e.id === entryId).feedback).toEqual(expected);
      const day = (await as.Ravi.get('/timeline')).body.data.entries;
      expect(day.find((e: any) => e.id === entryId).feedback).toEqual(expected);
    });
  });

  // --------------------------------------------------------------------- help

  describe('help requests', () => {
    let helpId: string;

    it('the owner asks every moderator of the project; one open at a time', async () => {
      const res = await as.Ravi.post(`/leads/${lead.id}/help`, {
        body: 'Client wants a discount I can’t approve.',
      });
      expect(res.status).toBe(201);
      helpId = res.body.data.id;
      expect(res.body.data).toMatchObject({ kind: 'help', canResolve: true });
      expect(res.body.data.mentions.map((p: any) => p.id)).toEqual([ids.Meera, ids.Omar]);

      for (const who of ['Meera', 'Omar']) {
        expect(await inbox(as[who], 'help_requested')).toEqual([
          expect.objectContaining({
            title: 'Ravi Kumar asked for help on Sharma Stores',
            link: `/leads/${lead.id}`,
          }),
        ]);
      }
      expect(await inbox(as.Farah, 'help_requested')).toEqual([]);

      expect((await as.Ravi.post(`/leads/${lead.id}/help`, { body: 'Again' })).status).toBe(409);
      expect((await as.Ravi.get(`/leads/${lead.id}`)).body.data.openHelp).toBe(true);
    });

    it('is for the owner or the backup covering for him', async () => {
      expect((await as.Meera.post(`/leads/${lead.id}/help`, { body: 'Help' })).status).toBe(403);
      expect((await as.Priya.post(`/leads/${lead.id}/help`, { body: 'Help' })).status).toBe(404);
    });

    it('shows on the dashboard of the project’s admins, first', async () => {
      const [first] = (await as.Meera.get('/dashboard')).body.data.needsAttention;
      expect(first).toEqual({
        kind: 'help_request',
        user: { id: ids.Ravi, name: 'Ravi Kumar' },
        projectName: 'North',
        detail: 'Asked for help on Sharma Stores',
        leadId: lead.id,
      });
      const farahs = (await as.Farah.get('/dashboard')).body.data.needsAttention;
      expect(farahs.some((item: any) => item.kind === 'help_request')).toBe(false);
    });

    it('is resolved by an admin, who tells the asker', async () => {
      expect((await as.Priya.post(`/comments/${helpId}/resolve`)).status).toBe(404);
      const res = await as.Omar.post(`/comments/${helpId}/resolve`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        resolvedBy: { id: ids.Omar, name: 'Omar Khan' },
        canResolve: false,
      });
      expect(await inbox(as.Ravi, 'help_resolved')).toEqual([
        expect.objectContaining({ title: 'Omar Khan resolved your help request on Sharma Stores' }),
      ]);
      expect((await as.Omar.post(`/comments/${helpId}/resolve`)).status).toBe(409);

      const plain = (await as.Ravi.get(`/leads/${lead.id}/comments`)).body.data.find(
        (c: any) => c.kind === 'comment',
      );
      expect((await as.Meera.post(`/comments/${plain.id}/resolve`)).status).toBe(422);

      expect((await as.Ravi.get(`/leads/${lead.id}`)).body.data.openHelp).toBe(false);
      const again = await as.Ravi.post(`/leads/${lead.id}/help`, { body: 'One more thing.' });
      expect(again.status).toBe(201);
      // The asker may close his own.
      expect((await as.Ravi.post(`/comments/${again.body.data.id}/resolve`)).status).toBe(200);
    });
  });

  // ------------------------------------------------------------ notifications

  describe('notifications', () => {
    it('are private: lists, counts and marks only the caller’s own', async () => {
      const ravis = await inbox(as.Ravi);
      expect(ravis.length).toBeGreaterThan(0);
      const before = (await as.Ravi.get('/notifications/unread-count')).body.data.count;
      expect(before).toBe(ravis.length);

      // Someone else's ids are ignored.
      const stranger = await as.Priya.post('/notifications/read', { ids: [ravis[0].id] });
      expect(stranger.status).toBe(200);
      expect(stranger.body.data).toEqual({ count: 0 });
      expect((await as.Ravi.get('/notifications/unread-count')).body.data.count).toBe(before);
      expect(await inbox(as.Priya)).toEqual([]);

      const one = await as.Ravi.post('/notifications/read', { ids: [ravis[0].id] });
      expect(one.body.data).toEqual({ count: before - 1 });
      const unread = (await as.Ravi.get('/notifications?unreadOnly=true&limit=100')).body.data;
      expect(unread.meta.total).toBe(before - 1);
      expect(unread.items.every((n: any) => n.readAt === null)).toBe(true);

      expect((await as.Ravi.post('/notifications/read', { all: true })).body.data).toEqual({
        count: 0,
      });
      expect((await as.Ravi.post('/notifications/read', {})).status).toBe(400);
      expect((await as.Ravi.get('/notifications')).body.data.items[0].readAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- transfers

  describe('transfers', () => {
    it('a request tells the project’s admins and pins the handover note', async () => {
      const res = await as.Ravi.post(`/leads/${lead.id}/transfers`, {
        toUserId: ids.Priya,
        reason: 'She covers Baner now.',
        handoverNote: 'Prefers calls after 6 pm.',
      });
      expect(res.status).toBe(201);

      for (const who of [as.Meera, as.Omar, admin]) {
        expect(await inbox(who, 'transfer_requested')).toEqual([
          expect.objectContaining({
            title: 'Ravi Kumar asked to hand over Sharma Stores to Priya Desai',
            body: 'She covers Baner now.',
            link: '/transfers',
          }),
        ]);
      }
      expect(await inbox(as.Farah, 'transfer_requested')).toEqual([]);
      expect(await inbox(as.Ravi, 'transfer_requested')).toEqual([]);

      const detail = (await as.Ravi.get(`/leads/${lead.id}`)).body.data;
      expect(detail.pinnedComment.body).toBe('Prefers calls after 6 pm.');
      const handover = (await as.Ravi.get(`/leads/${lead.id}/comments`)).body.data.find(
        (c: any) => c.kind === 'handover',
      );
      expect(handover).toMatchObject({ pinned: true, user: { id: ids.Ravi } });

      // Approved: the new owner gets the lead; the requester hears the decision.
      const approve = await as.Meera.post(`/transfers/${res.body.data.id}/approve`, {});
      expect(approve.status).toBe(200);
      expect(await inbox(as.Priya, 'lead_assigned')).toEqual([
        expect.objectContaining({
          title: 'Meera Nair assigned Sharma Stores to you',
          link: `/leads/${lead.id}`,
          leadId: lead.id,
        }),
      ]);
      expect(await inbox(as.Priya, 'transfer_decided')).toEqual([]);
      expect(await inbox(as.Ravi, 'transfer_decided')).toEqual([
        expect.objectContaining({
          title: 'Meera Nair approved the handover of Sharma Stores to Priya Desai',
          link: `/leads/${lead.id}`,
        }),
      ]);
      // The new owner reads the handover note; the old one can no longer open the lead.
      expect((await as.Priya.get(`/leads/${lead.id}`)).body.data.pinnedComment.body).toBe(
        'Prefers calls after 6 pm.',
      );
      expect((await as.Ravi.get(`/leads/${lead.id}/comments`)).status).not.toBe(200);
    });

    it('a rejection tells the requester', async () => {
      const other = await addLead(as.Ravi, { businessName: 'Bina Joshi' });
      const req = await as.Ravi.post(`/leads/${other.id}/transfers`, {
        toUserId: ids.Priya,
        reason: 'Too far for me.',
      });
      await as.Omar.post(`/transfers/${req.body.data.id}/reject`, { note: 'Keep trying.' });
      expect(await inbox(as.Ravi, 'transfer_decided')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Omar Khan rejected the handover of Bina Joshi to Priya Desai',
            body: 'Keep trying.',
          }),
        ]),
      );
      expect(await inbox(as.Priya, 'transfer_decided')).toEqual([]);

      // A direct reassignment names the lead.
      await as.Meera.post(`/leads/${other.id}/reassign`, {
        toUserId: ids.Priya,
        reason: 'Ravi is overloaded.',
      });
      expect((await inbox(as.Priya, 'lead_assigned')).filter((n) => n.leadId === other.id)).toEqual(
        [
          expect.objectContaining({
            title: 'Meera Nair assigned Bina Joshi to you',
            link: `/leads/${other.id}`,
          }),
        ],
      );
    });

    it('a bulk reassignment sends the new owner one summary', async () => {
      const a = await addLead(as.Ravi);
      const b = await addLead(as.Ravi);
      const res = await as.Meera.post(`/projects/${projects.North}/leads/reassign`, {
        leadIds: [a.id, b.id],
        toUserId: ids.Priya,
        reason: 'Ravi moved to South.',
        handoverNote: 'Both want a demo.',
      });
      expect(res.body.data).toEqual({ reassigned: 2, skipped: 0 });

      const summaries = (await inbox(as.Priya, 'lead_assigned')).filter((n) => n.link === '/leads');
      expect(summaries).toEqual([
        expect.objectContaining({
          title: 'Meera Nair assigned 2 leads in North to you',
          leadId: null,
        }),
      ]);
      for (const id of [a.id, b.id]) {
        expect((await as.Priya.get(`/leads/${id}`)).body.data.pinnedComment.body).toBe(
          'Both want a demo.',
        );
      }
    });
  });

  // --------------------------------------------------------- request by phone

  describe('asking for a lead by phone', () => {
    let wanted: any;

    beforeAll(async () => {
      wanted = await addLead(as.Ravi, { businessName: 'Chetan Mehta' });
    });

    it('offers the request when adding a number someone else owns', async () => {
      const res = await addLeadRaw(as.Priya, wanted.phone);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('DUPLICATE_LEAD_OTHER');
      expect(res.body.details).toEqual({ ownerName: 'Ravi Kumar', canRequest: true });
    });

    it('cannot be used for your own lead, an unknown number or another project', async () => {
      const own = await as.Ravi.post(`/projects/${projects.North}/leads/request-by-phone`, {
        phone: wanted.phone,
        reason: 'Mine anyway.',
      });
      expect(own.status).toBe(409);
      expect(own.body.errorCode).toBe('DUPLICATE_LEAD_OWN');
      expect(own.body.details).toEqual({ leadId: wanted.id });

      expect(
        (
          await as.Priya.post(`/projects/${projects.North}/leads/request-by-phone`, {
            phone: '9000000009',
            reason: 'Who is this?',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await as.Sana.post(`/projects/${projects.North}/leads/request-by-phone`, {
            phone: wanted.phone,
            reason: 'Not my project.',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await admin.post(`/projects/${projects.North}/leads/request-by-phone`, {
            phone: wanted.phone,
            reason: 'Admins do not hold leads.',
          })
        ).status,
      ).toBe(403);
    });

    it('creates a pending transfer from the owner to the caller, which admins decide', async () => {
      const res = await as.Priya.post(`/projects/${projects.North}/leads/request-by-phone`, {
        phone: `+91 ${wanted.phone.slice(0, 5)}-${wanted.phone.slice(5)}`,
        reason: 'Her brother is already my client.',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        lead: { id: wanted.id, projectId: projects.North },
        fromUser: { id: ids.Ravi },
        toUser: { id: ids.Priya },
        requestedBy: { id: ids.Priya },
        status: 'pending',
        canDecide: false,
      });
      const transferId = res.body.data.id;

      expect(
        (
          await as.Priya.post(`/projects/${projects.North}/leads/request-by-phone`, {
            phone: wanted.phone,
            reason: 'Again.',
          })
        ).status,
      ).toBe(409);

      // Both sides see it; nobody outside does.
      const listed = async (client: ApiClient) =>
        ((await client.get('/transfers?limit=100')).body.data.items as Array<any>).some(
          (t) => t.id === transferId,
        );
      expect(await listed(as.Priya)).toBe(true);
      expect(await listed(as.Ravi)).toBe(true);
      expect(await listed(as.Sana)).toBe(false);
      expect(await listed(as.Farah)).toBe(false);
      expect(
        (await inbox(as.Meera, 'transfer_requested')).some(
          (n) => n.title === 'Priya Desai asked for Chetan Mehta',
        ),
      ).toBe(true);

      await as.Omar.post(`/transfers/${transferId}/approve`, {});
      expect((await as.Priya.get(`/leads/${wanted.id}`)).body.data.owner.id).toBe(ids.Priya);
      // The requester is the new owner: told once, that the lead is hers.
      const priyas = (await inbox(as.Priya)).filter((n) => n.leadId === wanted.id);
      expect(priyas.map((n) => n.kind)).toEqual(['lead_assigned']);
      expect((await inbox(as.Ravi, 'transfer_decided')).some((n) => n.leadId === wanted.id)).toBe(
        true,
      );
    });
  });
});
