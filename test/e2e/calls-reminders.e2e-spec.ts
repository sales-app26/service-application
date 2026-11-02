import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import { istToday } from '../../src/common/utils';
import { addDays } from '../../src/common/utils/ist-time.util';
import { ApiClient } from '../support/api-client';
import { Harness, RECORDINGS_BUCKET, startHarness } from '../support/harness';

const audio = (seed: string): Buffer =>
  Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.from(seed.padEnd(64, '.'))]);

/** Calls prove themselves with a recording, and follow-ups with a time remind their owner. */
describe('Calls and reminders (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let ravi: ApiClient;
  let cara: ApiClient;
  let priya: ApiClient;
  const ids: Record<string, string> = {};
  let doorToDoor: string;
  let online: string;
  let phone = 9000000000;

  const newLead = async (project: string, businessName: string, owner = ids.Cara) =>
    (
      await admin.post(`/projects/${project}/leads/add`, {
        businessName,
        phone: String((phone += 1)),
        location: 'Kothrud',
        ownerId: owner,
      })
    ).body.data.id as string;

  const logCall = (
    client: ApiClient,
    leadId: string,
    fields: Record<string, string>,
    file?: Buffer,
  ) =>
    client.postForm(
      `/leads/${leadId}/follow-ups`,
      {
        clientRequestId: randomUUID(),
        channel: 'call',
        location: 'Kothrud',
        note: 'Logged a call here',
        ...fields,
      },
      file,
      'recording',
      'call.m4a',
      'audio/mp4',
    );

  const notifications = async (
    client: ApiClient,
  ): Promise<Array<{ title: string; kind: string }>> =>
    (await client.get('/notifications?limit=100')).body.data.items;

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));

    for (const [name, workType] of [
      ['Ravi Kumar', undefined],
      ['Cara Dsouza', 'calling'],
      ['Priya Desai', undefined],
    ] as const) {
      const first = name.split(' ')[0];
      const res = await admin.post('/users', {
        name,
        email: `${first.toLowerCase()}@pronttera.in`,
        role: 'sales_person',
        ...(workType ? { workType } : {}),
      });
      ids[first] = res.body.data.id;
    }
    ravi = api.as(await harness.supabase.accessToken(ids.Ravi));
    cara = api.as(await harness.supabase.accessToken(ids.Cara));
    priya = api.as(await harness.supabase.accessToken(ids.Priya));

    for (const [key, type] of [
      ['doorToDoor', 'door_to_door'],
      ['online', 'online'],
    ] as const) {
      const id = (await admin.post('/projects', { name: key, type, startDate: '2026-09-01' })).body
        .data.id as string;
      if (key === 'doorToDoor') doorToDoor = id;
      else online = id;
      for (const who of [ids.Ravi, ids.Cara, ids.Priya]) {
        await admin.post(`/projects/${id}/members`, { userId: who });
      }
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('who works where', () => {
    it('a new rep is Field unless told otherwise, and can be changed', async () => {
      expect((await ravi.get('/auth/me')).body.data.workType).toBe('field');
      expect((await cara.get('/auth/me')).body.data.workType).toBe('calling');

      const changed = await admin.patch(`/users/${ids.Priya}`, { workType: 'both' });
      expect(changed.body.data.workType).toBe('both');
    });
  });

  describe('logging a call', () => {
    it('an unanswered call needs no recording, keeps the status, and comes up tomorrow', async () => {
      const lead = await newLead(doorToDoor, 'No Answer Bakes');
      const res = await logCall(cara, lead, { callOutcome: 'no_answer', note: 'No answer' });
      expect(res.status).toBe(201);

      const detail = (await cara.get(`/leads/${lead}`)).body.data;
      expect(detail.status).toBe('new');
      expect(detail.nextFollowUpDate).toBe(addDays(istToday(), 1));

      const [entry] = (await cara.get(`/leads/${lead}/entries`)).body.data.items;
      expect(entry).toMatchObject({
        channel: 'call',
        callOutcome: 'no_answer',
        hasRecording: false,
        hasPhoto: false,
        status: 'new',
      });
    });

    it('a call that connected needs its recording, even door to door with no photo', async () => {
      const lead = await newLead(doorToDoor, 'Spoke Bakes');

      const none = await logCall(cara, lead, { callOutcome: 'spoke', status: 'interested' });
      expect(none.status).toBe(422);
      expect(none.body.errorCode).toBe('CALL_RECORDING_REQUIRED');

      const saved = await logCall(
        cara,
        lead,
        { callOutcome: 'spoke', status: 'interested' },
        audio('first call'),
      );
      expect(saved.status).toBe(201);
      expect((await cara.get(`/leads/${lead}`)).body.data.status).toBe('interested');

      const [entry] = (await cara.get(`/leads/${lead}/entries`)).body.data.items;
      expect(entry).toMatchObject({ channel: 'call', callOutcome: 'spoke', hasRecording: true });
      expect(JSON.stringify(entry)).not.toContain('calls/');
    });

    it('goes to a private bucket of its own; the link is for those who may see the entry', async () => {
      const lead = await newLead(doorToDoor, 'Private Bakes');
      await logCall(cara, lead, { callOutcome: 'spoke', status: 'contacted' }, audio('private'));
      expect(harness.supabase.buckets.get(RECORDINGS_BUCKET)).toEqual({ public: false });

      const [entry] = (await cara.get(`/leads/${lead}/entries`)).body.data.items;
      const link = await cara.get(`/entries/${entry.id}/recording`);
      expect(link.status).toBe(200);
      expect(link.body.data.url).toContain(RECORDINGS_BUCKET);
      const played = await fetch(link.body.data.url);
      expect(played.headers.get('content-type')).toBe('audio/mp4');

      expect((await admin.get(`/entries/${entry.id}/recording`)).status).toBe(200);
      expect((await priya.get(`/entries/${entry.id}/recording`)).status).toBe(404);
    });

    it('one recording can prove only one call', async () => {
      const first = await newLead(doorToDoor, 'Reuse One');
      const second = await newLead(doorToDoor, 'Reuse Two');
      const file = audio('same file');
      expect(
        (await logCall(cara, first, { callOutcome: 'spoke', status: 'contacted' }, file)).status,
      ).toBe(201);

      const again = await logCall(
        cara,
        second,
        { callOutcome: 'spoke', status: 'contacted' },
        file,
      );
      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/already on another call/u);
    });

    it('refuses a file that is not audio, whatever it claims to be', async () => {
      const lead = await newLead(doorToDoor, 'Fake Audio');
      const res = await logCall(
        cara,
        lead,
        { callOutcome: 'spoke', status: 'contacted' },
        Buffer.from('<html><script>alert(1)</script></html>'),
      );
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/isn’t a call recording/u);
    });

    it('a call needs an outcome', async () => {
      const lead = await newLead(doorToDoor, 'No Outcome');
      const res = await logCall(cara, lead, { status: 'contacted' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/how the call went/u);
    });
  });

  describe('what each person and campaign may log', () => {
    const logAs = (client: ApiClient, leadId: string, channel?: string) =>
      client.post(`/leads/${leadId}/follow-ups`, {
        clientRequestId: randomUUID(),
        status: 'contacted',
        note: 'A note long enough',
        location: 'Kothrud',
        ...(channel ? { channel } : {}),
      });

    it('someone set up for calling cannot log a visit', async () => {
      const lead = await newLead(doorToDoor, 'Caller Visit');
      const res = await logAs(cara, lead, 'visit');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/set up for calling/u);
    });

    it('a field rep can still log a call, and it never counts as a visit', async () => {
      const lead = await newLead(doorToDoor, 'Field Call', ids.Ravi);
      expect((await logCall(ravi, lead, { callOutcome: 'busy', note: 'Line busy' })).status).toBe(
        201,
      );
      const [entry] = (await ravi.get(`/leads/${lead}/entries`)).body.data.items;
      expect(entry).toMatchObject({ channel: 'call', hasPhoto: false });
    });

    it('door to door, a visit still needs its proof, and “other” cannot dodge it', async () => {
      const lead = await newLead(doorToDoor, 'Dodge', ids.Ravi);
      // An app from before this change sends no kind at all.
      const legacy = await logAs(ravi, lead);
      expect(legacy.status).toBe(422);
      expect(legacy.body.errorCode).toBe('VISIT_PROOF_REQUIRED');

      const other = await logAs(ravi, lead, 'other');
      expect(other.status).toBe(400);
      expect(other.body.message).toMatch(/visits and calls only/u);
    });

    it('online: no visits, and a note or WhatsApp logs as before', async () => {
      const lead = await newLead(online, 'Online One', ids.Ravi);
      expect((await logAs(ravi, lead, 'visit')).status).toBe(400);
      expect((await logAs(ravi, lead)).status).toBe(201);
      const [entry] = (await ravi.get(`/leads/${lead}/entries`)).body.data.items;
      expect(entry.channel).toBe('other');
    });

    it('deleting a campaign removes its recordings', async () => {
      const project = (
        await admin.post('/projects', {
          name: 'To Delete',
          type: 'online',
          startDate: '2026-09-01',
        })
      ).body.data.id as string;
      await admin.post(`/projects/${project}/members`, { userId: ids.Cara });
      const lead = await newLead(project, 'Gone Soon');
      await logCall(cara, lead, { callOutcome: 'spoke', status: 'contacted' }, audio('gone soon'));
      const key = (): string[] =>
        [...harness.supabase.objects.keys()].filter((k) => k.includes(project));
      expect(key()).toHaveLength(1);

      expect(
        (await admin.post(`/projects/${project}/delete`, { confirmName: 'To Delete' })).status,
      ).toBeLessThan(300);
      expect(key()).toHaveLength(0);
    });
  });

  describe('reminders', () => {
    const tomorrow = addDays(istToday(), 1);
    const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

    /** A lead Ravi owns, with its next follow-up set by a call he logged. */
    const scheduled = async (name: string, time: string, owner = ids.Ravi, client = ravi) => {
      const lead = await newLead(online, name, owner);
      const res = await logCall(client, lead, {
        callOutcome: 'no_answer',
        note: 'Asked to call back',
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: time,
        nextFollowUpChannel: 'call',
      });
      expect(res.status).toBe(201);
      return lead;
    };
    const titled = async (client: ApiClient, title: string) =>
      (await notifications(client)).filter((n) => n.title === title);

    it('keeps the time on the lead, in India time', async () => {
      const lead = await scheduled('Timed Bakes', '09:30');
      const detail = (await ravi.get(`/leads/${lead}`)).body.data;
      expect(detail).toMatchObject({
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '09:30',
        nextFollowUpChannel: 'call',
      });
    });

    it('reminds at the time, not before, and only once', async () => {
      await scheduled('Sweet Crumbs', '16:00');
      await harness.runReminders(at(tomorrow, '15:59'));
      expect(await titled(ravi, 'Time to call Sweet Crumbs')).toHaveLength(0);

      await harness.runReminders(at(tomorrow, '16:00'));
      const sent = await titled(ravi, 'Time to call Sweet Crumbs');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind: 'follow_up_reminder', body: 'Asked to call back' });

      await harness.runReminders(at(tomorrow, '16:01'));
      expect(await titled(ravi, 'Time to call Sweet Crumbs')).toHaveLength(1);
    });

    it('moving the time reminds again; a closed lead never does', async () => {
      const lead = await scheduled('Moved Bakes', '17:00');
      await harness.runReminders(at(tomorrow, '17:00'));
      await logCall(ravi, lead, {
        callOutcome: 'busy',
        note: 'Line busy again',
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '18:00',
        nextFollowUpChannel: 'call',
      });
      await harness.runReminders(at(tomorrow, '18:00'));
      expect(await titled(ravi, 'Time to call Moved Bakes')).toHaveLength(2);

      const closed = await scheduled('Closed Bakes', '19:00');
      await ravi.post(`/leads/${closed}/status`, {
        clientRequestId: randomUUID(),
        status: 'not_interested',
        note: 'Not interested at all',
        reason: 'price',
      });
      await harness.runReminders(at(tomorrow, '19:00'));
      expect(await titled(ravi, 'Time to call Closed Bakes')).toHaveLength(0);
    });

    it('a reminder long past its time is not sent late', async () => {
      await scheduled('Stale Bakes', '10:00');
      await harness.runReminders(at(tomorrow, '13:00'));
      expect(await titled(ravi, 'Time to call Stale Bakes')).toHaveLength(0);
    });

    it('on leave, the reminder goes to whoever covers', async () => {
      await scheduled('Covered Bakes', '20:00', ids.Priya, priya);
      await admin.put(`/projects/${online}/members/${ids.Priya}/backup`, {
        backupUserId: ids.Ravi,
      });
      const leave = await priya.post('/leaves', {
        startsOn: tomorrow,
        endsOn: tomorrow,
        note: 'Family function',
      });
      expect(leave.status).toBeLessThan(300);

      await harness.runReminders(at(tomorrow, '20:00'));
      expect(await titled(ravi, 'Time to call Covered Bakes')).toHaveLength(1);
      expect(await titled(priya, 'Time to call Covered Bakes')).toHaveLength(0);
    });

    it('pushes to a device, encrypted; a device that is gone is forgotten', async () => {
      const key = (): string => createECDH('prime256v1').generateKeys().toString('base64url');
      const auth = (): string => randomBytes(16).toString('base64url');
      await harness.db.query(
        `INSERT INTO sales.push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)`,
        [
          ids.Ravi,
          `${harness.supabase.url}/push/phone`,
          key(),
          auth(),
          `${harness.supabase.url}/push/gone`,
          key(),
          auth(),
        ],
      );

      await scheduled('Pushed Bakes', '21:00');
      await harness.runReminders(at(tomorrow, '21:00'));

      expect(harness.supabase.pushes).toEqual([{ device: 'phone', encrypted: true, vapid: true }]);
      const left = await harness.db.query<{ endpoint: string }>(
        'SELECT endpoint FROM sales.push_subscriptions',
      );
      expect(left.rows.map((row) => row.endpoint)).toEqual([`${harness.supabase.url}/push/phone`]);
    });

    it('sums up the morning once, from 9', async () => {
      const today = addDays(istToday(), 3);
      const lead = await newLead(online, 'Digest Bakes', ids.Cara);
      await logCall(cara, lead, {
        callOutcome: 'no_answer',
        note: 'No answer',
        nextFollowUpDate: today,
      });
      await harness.runReminders(at(today, '08:59'));
      const before = (await notifications(cara)).filter((n) => /today|overdue/u.test(n.title));

      await harness.runReminders(at(today, '09:00'));
      const after = (await notifications(cara)).filter((n) => /today|overdue/u.test(n.title));
      expect(after.length).toBe(before.length + 1);

      await harness.runReminders(at(today, '09:01'));
      expect(
        (await notifications(cara)).filter((n) => /today|overdue/u.test(n.title)),
      ).toHaveLength(after.length);
    });

    it('takes a device only from a real push service', async () => {
      const keys = { p256dh: 'p256dh-key', auth: 'auth-key' };
      expect((await ravi.get('/notifications/push/key')).body.data.publicKey).toBeTruthy();

      const inside = await ravi.post('/notifications/push', {
        endpoint: 'https://169.254.169.254/latest/meta-data',
        keys,
      });
      expect(inside.status).toBe(400);
      expect(
        (await ravi.post('/notifications/push', { endpoint: 'http://fcm.googleapis.com/x', keys }))
          .status,
      ).toBe(400);

      const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
      expect((await ravi.post('/notifications/push', { endpoint, keys })).status).toBe(200);
      expect((await priya.post('/notifications/push', { endpoint, keys })).status).toBe(200);
      const owners = await harness.db.query<{ user_id: string }>(
        'SELECT user_id FROM sales.push_subscriptions WHERE endpoint = $1',
        [endpoint],
      );
      expect(owners.rows.map((row) => row.user_id)).toEqual([ids.Priya]);

      expect((await ravi.post('/notifications/push/remove', { endpoint })).status).toBe(200);
      expect((await priya.post('/notifications/push/remove', { endpoint })).status).toBe(200);
      const gone = await harness.db.query(
        'SELECT 1 FROM sales.push_subscriptions WHERE endpoint = $1',
        [endpoint],
      );
      expect(gone.rows).toHaveLength(0);
    });
  });
});
