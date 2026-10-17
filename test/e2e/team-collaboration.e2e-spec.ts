import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

const DAY_MS = 24 * 60 * 60 * 1000;
const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
const plusDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Team collaboration (`06_team_collaboration.sql`), people side: leave, backups, covering
 * for someone on leave, the dashboard skipping people on leave, the roster, the
 * leaderboard and message templates — each with the scoping a moderator or a rep must
 * not get around.
 */
describe('Team collaboration (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  const ids: Record<string, string> = {};
  const as: Record<string, ApiClient> = {};
  const projects: Record<string, string> = {};
  const today = istDate(new Date());
  let phone = 9876510000;

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
      expect(
        (await admin.post(`/projects/${projects[key]}/members`, { userId: ids[m] })).status,
      ).toBe(201);
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
  const inbox = async (client: ApiClient) => {
    const res = await client.get('/notifications?limit=100');
    expect(res.status).toBe(200);
    return res.body.data.items as Array<any>;
  };
  const sql = (text: string, params: unknown[] = []) => harness.db.query(text, params);

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    await person('Meera Nair', 'moderator');
    await person('Omar Khan', 'moderator');
    await person('Farah Ali', 'moderator');
    await person('Ravi Kumar', 'sales_person');
    await person('Priya Desai', 'sales_person');
    await person('Kiran Rao', 'sales_person');
    await person('Sana Shaikh', 'sales_person');
    await project('North', ['Meera', 'Omar', 'Ravi', 'Priya', 'Kiran']);
    await project('South', ['Farah', 'Sana']);
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ------------------------------------------------------------------ backups

  describe('backups', () => {
    it('an admin sets a member’s backup, which every member sees on the member rows', async () => {
      const res = await as.Meera.put(`/projects/${projects.North}/members/${ids.Ravi}/backup`, {
        backupUserId: ids.Priya,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        userId: ids.Ravi,
        backup: { id: ids.Priya, name: 'Priya Desai' },
        onLeave: null,
      });

      const rows = (await as.Kiran.get(`/projects/${projects.North}/members`)).body.data;
      expect(rows.find((row: any) => row.userId === ids.Ravi).backup).toEqual({
        id: ids.Priya,
        name: 'Priya Desai',
      });
      expect(rows.find((row: any) => row.userId === ids.Kiran).backup).toBeNull();
    });

    it.each([
      ['someone outside the project', 'Sana'],
      ['the member himself', 'Ravi'],
    ])('refuses %s as the backup', async (_, who) => {
      const res = await as.Meera.put(`/projects/${projects.North}/members/${ids.Ravi}/backup`, {
        backupUserId: ids[who],
      });
      expect(res.status).toBe(422);
    });

    it('refuses the Super Admin as a backup', async () => {
      const res = await admin.put(`/projects/${projects.North}/members/${ids.Ravi}/backup`, {
        backupUserId: harness.superAdminId,
      });
      expect(res.status).toBe(422);
    });

    it('a moderator sets backups only for sales persons and himself, in his projects', async () => {
      const otherModerator = await as.Meera.put(
        `/projects/${projects.North}/members/${ids.Omar}/backup`,
        { backupUserId: ids.Priya },
      );
      expect(otherModerator.status).toBe(403);
      expect(
        (
          await as.Meera.put(`/projects/${projects.South}/members/${ids.Sana}/backup`, {
            backupUserId: ids.Farah,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await as.Ravi.put(`/projects/${projects.North}/members/${ids.Kiran}/backup`, {
            backupUserId: ids.Ravi,
          })
        ).status,
      ).toBe(403);
      // Himself is fine.
      expect(
        (
          await as.Meera.put(`/projects/${projects.North}/members/${ids.Meera}/backup`, {
            backupUserId: ids.Omar,
          })
        ).status,
      ).toBe(200);
    });

    it('removing a member clears every backup pointing to him there', async () => {
      await person('Temp Worker', 'sales_person');
      await admin.post(`/projects/${projects.North}/members`, { userId: ids.Temp });
      await as.Meera.put(`/projects/${projects.North}/members/${ids.Kiran}/backup`, {
        backupUserId: ids.Temp,
      });
      expect((await admin.delete(`/projects/${projects.North}/members/${ids.Temp}`)).status).toBe(
        200,
      );
      const rows = (await as.Meera.get(`/projects/${projects.North}/members`)).body.data;
      expect(rows.find((row: any) => row.userId === ids.Kiran).backup).toBeNull();
    });
  });

  // -------------------------------------------------------------------- leave

  describe('leave', () => {
    let ravisLeave: string;
    let kiransLeave: string;

    it('anyone books his own leave, and the backup is told', async () => {
      const res = await as.Ravi.post('/leaves', {
        startsOn: today,
        endsOn: plusDays(today, 2),
        note: '  Family wedding ',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        user: { id: ids.Ravi, name: 'Ravi Kumar' },
        startsOn: today,
        endsOn: plusDays(today, 2),
        note: 'Family wedding',
        createdBy: { id: ids.Ravi, name: 'Ravi Kumar' },
      });
      ravisLeave = res.body.data.id;

      const [cover] = (await inbox(as.Priya)).filter((n) => n.kind === 'leave_cover');
      expect(cover).toMatchObject({
        title: expect.stringMatching(/^Ravi Kumar is on leave /),
        body: "You're covering their follow-ups in North.",
        link: '/home',
        actor: { id: ids.Ravi, name: 'Ravi Kumar' },
        readAt: null,
      });
      // Nobody else hears about it.
      expect((await inbox(as.Kiran)).filter((n) => n.kind === 'leave_cover')).toEqual([]);
    });

    it.each([
      ['an overlapping leave', 1, 3, 409],
      ['a leave over before today', -3, -1, 400],
      ['more than 60 days', 10, 71, 400],
      ['a last day before the first', 12, 11, 400],
    ])('refuses %s', async (_, from, to, status) => {
      const res = await as.Ravi.post('/leaves', {
        startsOn: plusDays(today, from),
        endsOn: plusDays(today, to),
      });
      expect(res.status).toBe(status);
    });

    it('books for someone else only within reach', async () => {
      const window = { startsOn: plusDays(today, 10), endsOn: plusDays(today, 12) };
      expect((await as.Priya.post('/leaves', { userId: ids.Ravi, ...window })).status).toBe(403);
      // Sana works only in Farah's project; Omar is a moderator.
      expect((await as.Meera.post('/leaves', { userId: ids.Sana, ...window })).status).toBe(403);
      expect((await as.Meera.post('/leaves', { userId: ids.Omar, ...window })).status).toBe(403);

      const res = await as.Meera.post('/leaves', { userId: ids.Kiran, ...window });
      expect(res.status).toBe(201);
      expect(res.body.data.createdBy).toEqual({ id: ids.Meera, name: 'Meera Nair' });
      kiransLeave = res.body.data.id;

      expect(
        (
          await as.Sana.post('/leaves', {
            startsOn: plusDays(today, 5),
            endsOn: plusDays(today, 6),
          })
        ).status,
      ).toBe(201);
    });

    it('shows who is on leave on me, the member rows and the user rows', async () => {
      const me = (await as.Ravi.get('/auth/me')).body.data;
      expect(me.onLeave).toEqual({ startsOn: today, endsOn: plusDays(today, 2) });
      expect(me.nextLeave).toBeNull();

      const kiran = (await as.Kiran.get('/auth/me')).body.data;
      expect(kiran.onLeave).toBeNull();
      expect(kiran.nextLeave).toEqual({
        startsOn: plusDays(today, 10),
        endsOn: plusDays(today, 12),
      });

      const members = (await as.Priya.get(`/projects/${projects.North}/members`)).body.data;
      expect(members.find((row: any) => row.userId === ids.Ravi).onLeave).toEqual(me.onLeave);
      expect(members.find((row: any) => row.userId === ids.Kiran).onLeave).toBeNull();

      const users = (await as.Meera.get('/users?limit=100')).body.data.items;
      expect(users.find((row: any) => row.id === ids.Ravi).onLeave).toEqual(me.onLeave);
      expect((await admin.get(`/users/${ids.Ravi}`)).body.data.onLeave).toEqual(me.onLeave);

      // A moderator sees every sales person, but the leave only of those he manages.
      await admin.post('/leaves', { userId: ids.Sana, startsOn: today, endsOn: today });
      const sana = { startsOn: today, endsOn: today };
      expect(users.find((row: any) => row.id === ids.Sana)).toBeDefined();
      const again = (await as.Meera.get('/users?limit=100')).body.data.items;
      expect(again.find((row: any) => row.id === ids.Sana).onLeave).toBeNull();
      expect((await as.Meera.get(`/users/${ids.Sana}`)).body.data.onLeave).toBeNull();
      expect((await admin.get(`/users/${ids.Sana}`)).body.data.onLeave).toEqual(sana);
    });

    it('lists leaves within each person’s reach', async () => {
      const own = (await as.Ravi.get('/leaves')).body.data as Array<any>;
      expect(own.map((leave) => leave.user.id)).toEqual([ids.Ravi]);
      expect((await as.Ravi.get(`/leaves?userId=${ids.Kiran}`)).status).toBe(403);

      const meeras = (await as.Meera.get('/leaves')).body.data as Array<any>;
      expect(meeras.map((leave) => leave.user.id).sort()).toEqual([ids.Ravi, ids.Kiran].sort());
      expect((await as.Meera.get(`/leaves?userId=${ids.Sana}`)).status).toBe(404);
      expect((await as.Meera.get(`/leaves?userId=${ids.Kiran}`)).body.data).toHaveLength(1);

      const everyone = (await admin.get('/leaves')).body.data as Array<any>;
      expect(everyone.map((leave) => leave.user.id)).toContain(ids.Sana);
    });

    it('is cancelled by the person or whoever could book it, nobody else', async () => {
      expect((await as.Priya.delete(`/leaves/${kiransLeave}`)).status).toBe(404);
      expect((await as.Farah.delete(`/leaves/${kiransLeave}`)).status).toBe(404);
      expect((await as.Meera.delete(`/leaves/${kiransLeave}`)).status).toBe(200);
      expect((await as.Meera.delete(`/leaves/${kiransLeave}`)).status).toBe(404);
      expect((await as.Kiran.get('/auth/me')).body.data.nextLeave).toBeNull();
      expect(ravisLeave).toBeDefined();
    });
  });

  // ----------------------------------------------------------------- covering

  describe('covering for someone on leave', () => {
    let due: any;
    let other: any;
    let priyasLead: any;

    beforeAll(async () => {
      // Ravi (on leave today, backed up by Priya) has two leads: one due today, one overdue.
      due = await addLead(as.Ravi, { status: 'follow_up_scheduled', nextFollowUpDate: today });
      other = await addLead(as.Ravi, { status: 'interested', nextFollowUpDate: today });
      await sql(`UPDATE sales.leads SET next_follow_up_date = $1 WHERE id = $2`, [
        plusDays(today, -2),
        other.id,
      ]);
      priyasLead = await addLead(as.Priya);
      // Kiran backs Priya up, but Priya is not on leave.
      await as.Meera.put(`/projects/${projects.North}/members/${ids.Priya}/backup`, {
        backupUserId: ids.Kiran,
      });
    });

    it('the backup sees who he is covering for and their due work', async () => {
      const res = await as.Priya.get('/me/covering');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          user: { id: ids.Ravi, name: 'Ravi Kumar' },
          projectId: projects.North,
          projectName: 'North',
          leave: { startsOn: today, endsOn: plusDays(today, 2) },
          dueToday: 2,
          overdue: 1,
        },
      ]);
      expect((await as.Kiran.get('/me/covering')).body.data).toEqual([]);
      expect((await as.Sana.get(`/me/covering?projectId=${projects.North}`)).status).toBe(404);
    });

    it('lists the owner’s leads only while covering him', async () => {
      const res = await as.Priya.get(
        `/projects/${projects.North}/leads?coveringFor=${ids.Ravi}&limit=100`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((lead: any) => lead.id).sort()).toEqual(
        [due.id, other.id].sort(),
      );
      // Other filters still apply.
      const overdue = await as.Priya.get(
        `/projects/${projects.North}/leads?coveringFor=${ids.Ravi}&due=overdue`,
      );
      expect(overdue.body.data.items.map((lead: any) => lead.id)).toEqual([other.id]);

      // Not his backup; and a backup whose owner is not on leave.
      expect(
        (await as.Kiran.get(`/projects/${projects.North}/leads?coveringFor=${ids.Ravi}`)).status,
      ).toBe(403);
      expect(
        (await as.Kiran.get(`/projects/${projects.North}/leads?coveringFor=${ids.Priya}`)).status,
      ).toBe(403);
      expect(
        (await as.Sana.get(`/projects/${projects.North}/leads?coveringFor=${ids.Ravi}`)).status,
      ).toBe(404);
    });

    it('opens the owner’s lead with covering permissions only', async () => {
      const res = await as.Priya.get(`/leads/${due.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.coveringFor).toEqual({ id: ids.Ravi, name: 'Ravi Kumar' });
      expect(res.body.data.permissions).toMatchObject({
        covering: true,
        canLogFollowUp: true,
        canChangeStatus: true,
        canLeaveConverted: false,
        canEdit: false,
        canRequestTransfer: false,
        canReassign: false,
        canDelete: false,
      });
      expect((await as.Priya.get(`/leads/${due.id}/entries`)).status).toBe(200);
      const entryId = res.body.data.recentEntries[0].id;
      expect((await as.Priya.get(`/entries/${entryId}`)).status).toBe(200);

      // The owner himself is not "covering".
      const owners = (await as.Ravi.get(`/leads/${due.id}`)).body.data;
      expect(owners.coveringFor).toBeNull();
      expect(owners.permissions.covering).toBe(false);
    });

    it('logs follow-ups and status changes for the owner, who keeps the lead and the credit', async () => {
      const before = (await as.Ravi.get(`/leads/${due.id}`)).body.data.lastActivityAt;
      const res = await as.Priya.post(`/leads/${due.id}/follow-ups`, {
        status: 'converted',
        note: 'Closed the deal while Ravi is away.',
        location: 'Baner',
        dealValue: 999,
        clientRequestId: requestId(),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.entry).toMatchObject({
        user: { id: ids.Priya, name: 'Priya Desai' },
        coveringFor: { id: ids.Ravi, name: 'Ravi Kumar' },
        feedback: [],
      });
      expect(res.body.data.lead.owner.id).toBe(ids.Ravi);
      expect(Date.parse(res.body.data.lead.lastActivityAt)).toBeGreaterThan(Date.parse(before));
      const { rows } = await sql(`SELECT owner_id, converted_by FROM sales.leads WHERE id = $1`, [
        due.id,
      ]);
      expect(rows[0]).toEqual({ owner_id: ids.Ravi, converted_by: ids.Ravi });

      const status = await as.Priya.post(`/leads/${other.id}/status`, {
        status: 'follow_up_scheduled',
        nextFollowUpDate: plusDays(today, 1),
        note: 'Rescheduled for Ravi.',
        clientRequestId: requestId(),
      });
      expect(status.status).toBe(200);
      expect(status.body.data.entry.coveringFor).toEqual({ id: ids.Ravi, name: 'Ravi Kumar' });

      // A backup cannot undo a conversion: only an admin can.
      const undo = await as.Priya.post(`/leads/${due.id}/status`, {
        status: 'lost',
        note: 'Changed my mind.',
        clientRequestId: requestId(),
      });
      expect(undo.status).toBe(403);
    });

    it('comments and asks for help on the owner’s lead, and can be mentioned there', async () => {
      const mentionable = (await as.Ravi.get(`/leads/${other.id}/mentionable`)).body.data;
      expect(mentionable.map((p: any) => p.id)).toEqual([ids.Meera, ids.Omar, ids.Priya]);
      const priyas = (await as.Priya.get(`/leads/${other.id}/mentionable`)).body.data;
      expect(priyas.map((p: any) => p.id)).toEqual([ids.Meera, ids.Omar, ids.Ravi]);
      // Kiran backs up Priya, who is at work: not someone to mention on her lead.
      const onPriyas = (await as.Priya.get(`/leads/${priyasLead.id}/mentionable`)).body.data;
      expect(onPriyas.map((p: any) => p.id)).not.toContain(ids.Kiran);

      const res = await as.Priya.post(`/leads/${other.id}/comments`, {
        body: 'Called, no answer.',
      });
      expect(res.status).toBe(201);
      expect((await inbox(as.Ravi)).some((n) => n.kind === 'comment')).toBe(true);
      const help = await as.Priya.post(`/leads/${other.id}/help`, {
        body: 'Client asks for Ravi.',
      });
      expect(help.status).toBe(201);
      expect((await as.Priya.post(`/comments/${help.body.data.id}/resolve`)).status).toBe(200);
      // Pinning is for the owner and admins.
      expect((await as.Priya.patch(`/comments/${res.body.data.id}`, { pinned: true })).status).toBe(
        403,
      );
    });

    it('does not edit, transfer or take over the lead', async () => {
      expect((await as.Priya.patch(`/leads/${other.id}`, { name: 'Renamed' })).status).toBe(403);
      expect(
        (
          await as.Priya.post(`/leads/${other.id}/transfers`, {
            toUserId: ids.Priya,
            reason: 'Mine now.',
          })
        ).status,
      ).toBe(403);
    });

    it('nobody else covers: not another rep, and not a backup whose owner is at work', async () => {
      expect((await as.Kiran.get(`/leads/${due.id}`)).status).toBe(404);
      expect(
        (
          await as.Kiran.post(`/leads/${other.id}/follow-ups`, {
            status: 'interested',
            note: 'Trying to log on Ravi’s lead.',
            location: 'Baner',
            clientRequestId: requestId(),
          })
        ).status,
      ).toBe(404);
      expect((await as.Kiran.get(`/leads/${priyasLead.id}`)).status).toBe(404);
      expect(
        (
          await as.Kiran.post(`/leads/${priyasLead.id}/status`, {
            status: 'interested',
            note: 'Not my lead.',
            clientRequestId: requestId(),
          })
        ).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------- dashboard

  describe('dashboard', () => {
    it('leaves people on leave out of "logged nothing today" and "idle"', async () => {
      await person('Dev Mehta', 'sales_person');
      await admin.post(`/projects/${projects.North}/members`, { userId: ids.Dev });
      // Dev joined a week ago and owns a lead he has not touched since.
      await sql(
        `UPDATE sales.project_members SET joined_at = now() - interval '7 days' WHERE user_id = $1`,
        [ids.Dev],
      );
      const { rows } = await sql(`SELECT id FROM sales.locations WHERE project_id = $1 LIMIT 1`, [
        projects.North,
      ]);
      await sql(
        `INSERT INTO sales.leads (project_id, owner_id, name, phone, location_id, created_by)
         VALUES ($1, $2, 'Old Lead', '9876599999', $3, $2)`,
        [projects.North, ids.Dev, (rows[0] as { id: string }).id],
      );

      const flagged = async () => {
        const data = (await as.Meera.get('/dashboard')).body.data;
        return {
          nothingToday: data.loggedNothingToday.some((row: any) => row.user.id === ids.Dev),
          idle: data.needsAttention.some(
            (item: any) => item.kind === 'idle' && item.user.id === ids.Dev,
          ),
        };
      };
      expect(await flagged()).toEqual({ nothingToday: true, idle: true });

      await admin.post('/leaves', { userId: ids.Dev, startsOn: today, endsOn: today });
      expect(await flagged()).toEqual({ nothingToday: false, idle: false });
    });
  });

  // ------------------------------------------------------------------- roster

  describe('roster', () => {
    it('lists the moderator’s own projects’ people once each, on leave last', async () => {
      await as.Meera.patch(`/projects/${projects.North}/members/${ids.Priya}/target`, {
        targetCount: 5,
        targetPeriod: 'weekly',
      });
      const res = await as.Meera.get('/team/roster');
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<any>;
      const names = rows.map((row) => row.user.name);
      expect(names).not.toContain('Sana Shaikh');
      expect(names).not.toContain('Farah Ali');
      expect(new Set(names).size).toBe(names.length);
      // Ravi and Dev are on leave today: last.
      expect(names.slice(-2).sort()).toEqual(['Dev Mehta', 'Ravi Kumar']);

      const ravi = rows.find((row) => row.user.id === ids.Ravi);
      expect(ravi).toMatchObject({
        user: { id: ids.Ravi, name: 'Ravi Kumar', email: 'ravi@pronttera.in', phone: null },
        role: 'sales_person',
        projects: [{ id: projects.North, name: 'North' }],
        onLeave: { startsOn: today, endsOn: plusDays(today, 2) },
        nextLeave: null,
        backup: null,
        target: null,
        openLeads: 1,
        dueToday: 0,
        overdue: 0,
      });
      expect(Date.parse(ravi.lastActivityAt)).not.toBeNaN();
    });

    it('with a project, adds each person’s backup and target there', async () => {
      const rows = (await as.Meera.get(`/team/roster?projectId=${projects.North}`)).body
        .data as Array<any>;
      expect(rows.find((row) => row.user.id === ids.Ravi).backup).toEqual({
        id: ids.Priya,
        name: 'Priya Desai',
      });
      expect(rows.find((row) => row.user.id === ids.Priya)).toMatchObject({
        target: { count: 5, period: 'weekly', achieved: 0 },
        followUpsToday: 2,
      });
    });

    it('is for admins, each within his own projects', async () => {
      expect((await as.Meera.get(`/team/roster?projectId=${projects.South}`)).status).toBe(404);
      expect((await as.Ravi.get('/team/roster')).status).toBe(403);
      const everyone = (await admin.get('/team/roster')).body.data as Array<any>;
      expect(everyone.map((row) => row.user.id)).toEqual(expect.arrayContaining([ids.Sana]));
    });
  });

  // -------------------------------------------------------------- leaderboard

  describe('leaderboard', () => {
    it('ranks the project’s people by conversions then follow-ups', async () => {
      const res = await as.Priya.get(`/projects/${projects.North}/leaderboard`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ period: 'week' });
      expect(res.body.data.from <= today && today <= res.body.data.to).toBe(true);

      const rows = res.body.data.rows as Array<any>;
      // Ravi has the conversion Priya logged while covering for him.
      expect(rows[0]).toMatchObject({
        user: { id: ids.Ravi },
        conversions: 1,
        rank: 1,
        isMe: false,
      });
      const priya = rows.find((row) => row.user.id === ids.Priya);
      // Her own lead's first entry and the follow-up she logged for Ravi.
      expect(priya).toMatchObject({ conversions: 0, followUps: 2, rank: 2, isMe: true });
      expect(rows.map((row) => row.user.id)).toEqual(expect.arrayContaining([ids.Meera, ids.Omar]));
      expect(rows.every((row) => !('revenue' in row))).toBe(true);

      const month = await as.Priya.get(`/projects/${projects.North}/leaderboard?period=month`);
      expect(month.body.data.period).toBe('month');
      expect(month.body.data.from.endsWith('-01')).toBe(true);
    });

    it('is for members of the project and the Super Admin', async () => {
      expect((await as.Sana.get(`/projects/${projects.North}/leaderboard`)).status).toBe(404);
      expect((await as.Farah.get(`/projects/${projects.North}/leaderboard`)).status).toBe(404);
      expect((await admin.get(`/projects/${projects.North}/leaderboard`)).status).toBe(200);
      expect(
        (await as.Priya.get(`/projects/${projects.North}/leaderboard?period=year`)).status,
      ).toBe(400);
    });
  });

  // ---------------------------------------------------------------- templates

  describe('message templates', () => {
    let templateId: string;

    it('admins write them; every member reads them in order', async () => {
      const first = await as.Meera.post(`/projects/${projects.North}/templates`, {
        label: 'Follow up',
        body: 'Hi {client}, {rep} here from {business} — checking in.',
        sort: 2,
      });
      expect(first.status).toBe(201);
      templateId = first.body.data.id;
      expect(first.body.data).toEqual({
        id: templateId,
        label: 'Follow up',
        body: 'Hi {client}, {rep} here from {business} — checking in.',
        sort: 2,
      });
      await admin.post(`/projects/${projects.North}/templates`, {
        label: 'Intro',
        body: 'Hello {client}!',
      });

      const list = await as.Ravi.get(`/projects/${projects.North}/templates`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((t: any) => t.label)).toEqual(['Intro', 'Follow up']);
    });

    it('refuses writes from members who are not admins, and everything to outsiders', async () => {
      expect(
        (await as.Ravi.post(`/projects/${projects.North}/templates`, { label: 'X', body: 'Y' }))
          .status,
      ).toBe(403);
      expect((await as.Sana.get(`/projects/${projects.North}/templates`)).status).toBe(404);
      expect((await as.Farah.patch(`/templates/${templateId}`, { label: 'Mine' })).status).toBe(
        404,
      );
      expect((await as.Farah.delete(`/templates/${templateId}`)).status).toBe(404);
      expect(
        (
          await as.Meera.post(`/projects/${projects.North}/templates`, {
            label: 'x'.repeat(41),
            body: 'Y',
          })
        ).status,
      ).toBe(400);
    });

    it('admins edit and delete them', async () => {
      const edited = await as.Omar.patch(`/templates/${templateId}`, {
        label: 'Check-in',
        sort: 0,
      });
      expect(edited.status).toBe(200);
      expect(edited.body.data).toMatchObject({ label: 'Check-in', sort: 0 });
      expect((await as.Meera.delete(`/templates/${templateId}`)).status).toBe(200);
      const list = (await as.Ravi.get(`/projects/${projects.North}/templates`)).body.data;
      expect(list.map((t: any) => t.label)).toEqual(['Intro']);
      expect((await as.Meera.patch(`/templates/${templateId}`, { label: 'Back' })).status).toBe(
        404,
      );
    });
  });

  // ------------------------------------------------------------- end of cover

  describe('end of cover', () => {
    it('the cover ends with the leave', async () => {
      const lead = (await as.Ravi.get(`/projects/${projects.North}/leads?limit=1`)).body.data
        .items[0];
      expect((await as.Priya.get(`/leads/${lead.id}`)).status).toBe(200);

      const [leave] = (await as.Ravi.get('/leaves')).body.data;
      expect((await as.Ravi.delete(`/leaves/${leave.id}`)).status).toBe(200);

      expect((await as.Priya.get(`/leads/${lead.id}`)).status).toBe(404);
      expect((await as.Priya.get('/me/covering')).body.data).toEqual([]);
    });
  });
});
