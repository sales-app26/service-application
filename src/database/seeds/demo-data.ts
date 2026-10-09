import { LeadStatus, ProjectType, TargetPeriod, UserRole } from '../../common/enums';

/**
 * The demo story. Day offsets are relative to "today" in India when the seed
 * runs, so the dashboard always shows a live-looking week: conversions this
 * week, follow-ups due today and overdue, someone who has logged nothing yet.
 */

export const DEMO_EMAIL_DOMAIN = 'demo.pronttera.in';
export const DEMO_PASSWORD = 'Demo@2026';
/** Every demo project's description starts with this; the reset finds them by it. */
export const DEMO_MARKER = '[Demo data]';

export type PersonKey =
  'priya' | 'arjun' | 'ravi' | 'neha' | 'imran' | 'vikram' | 'sneha' | 'karan';

export interface DemoPerson {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  /** Deactivated after the history is written. */
  deactivated?: boolean;
}

export const PEOPLE: Record<PersonKey, DemoPerson> = {
  priya: { name: 'Priya Menon', email: 'priya', phone: '9820011001', role: UserRole.MODERATOR },
  arjun: { name: 'Arjun Rao', email: 'arjun', phone: '9820011002', role: UserRole.MODERATOR },
  ravi: { name: 'Ravi Kumar', email: 'ravi', phone: '9820011003', role: UserRole.SALES_PERSON },
  neha: { name: 'Neha Patil', email: 'neha', phone: '9820011004', role: UserRole.SALES_PERSON },
  imran: { name: 'Imran Shaikh', email: 'imran', phone: '9820011005', role: UserRole.SALES_PERSON },
  vikram: {
    name: 'Vikram Singh',
    email: 'vikram',
    phone: '9820011006',
    role: UserRole.SALES_PERSON,
    deactivated: true,
  },
  sneha: { name: 'Sneha Iyer', email: 'sneha', phone: '9820011007', role: UserRole.SALES_PERSON },
  karan: { name: 'Karan Mehta', email: 'karan', phone: '9820011008', role: UserRole.SALES_PERSON },
};

export type ProjectKey = 'pune' | 'bangalore' | 'mumbai' | 'hyderabad';

export interface DemoMember {
  person: PersonKey;
  target?: [number, TargetPeriod];
}

export interface DemoProject {
  name: string;
  description: string;
  type: ProjectType;
  startDate: string;
  endDate: string | null;
  closedDaysAgo?: number;
  members: DemoMember[];
  /** Location → approximate centre, for door-to-door GPS. */
  locations: Record<string, [number, number]>;
}

export const PROJECTS: Record<ProjectKey, DemoProject> = {
  pune: {
    name: 'Pune Retail Drive — Q4',
    description: 'Door-to-door visits to neighbourhood shops for the billing app.',
    type: ProjectType.DOOR_TO_DOOR,
    startDate: '2026-09-15',
    endDate: '2026-12-31',
    members: [
      { person: 'priya', target: [2, TargetPeriod.WEEKLY] },
      { person: 'ravi', target: [4, TargetPeriod.WEEKLY] },
      { person: 'neha', target: [3, TargetPeriod.WEEKLY] },
      { person: 'imran', target: [10, TargetPeriod.MONTHLY] },
      { person: 'vikram', target: [3, TargetPeriod.WEEKLY] },
    ],
    locations: {
      'Koregaon Park': [18.5362, 73.894],
      Wanowrie: [18.488, 73.899],
      Kothrud: [18.5074, 73.8077],
      Baner: [18.559, 73.7868],
      'Viman Nagar': [18.5679, 73.9143],
      Hadapsar: [18.5089, 73.926],
      Camp: [18.515, 73.878],
    },
  },
  bangalore: {
    name: 'Bangalore SaaS Outreach',
    description: 'Phone and video outreach to small businesses and studios.',
    type: ProjectType.ONLINE,
    startDate: '2026-09-01',
    endDate: null,
    members: [
      { person: 'arjun' },
      { person: 'sneha', target: [12, TargetPeriod.MONTHLY] },
      { person: 'karan', target: [3, TargetPeriod.WEEKLY] },
      { person: 'ravi', target: [2, TargetPeriod.WEEKLY] },
    ],
    locations: {
      Indiranagar: [0, 0],
      Koramangala: [0, 0],
      'HSR Layout': [0, 0],
      Whitefield: [0, 0],
      Jayanagar: [0, 0],
    },
  },
  mumbai: {
    name: 'Mumbai Monsoon Campaign',
    description: 'Seasonal campaign, finished and archived.',
    type: ProjectType.ONLINE,
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    closedDaysAgo: 38,
    members: [{ person: 'karan', target: [5, TargetPeriod.MONTHLY] }, { person: 'arjun' }],
    locations: { Andheri: [0, 0], Bandra: [0, 0] },
  },
  hyderabad: {
    name: 'Hyderabad Pilot',
    description: 'Pilot that ran past its planned end date and is still open.',
    type: ProjectType.DOOR_TO_DOOR,
    startDate: '2026-08-01',
    endDate: '2026-09-30',
    members: [{ person: 'priya' }],
    locations: {},
  },
};

/** One entry in a lead's history. */
export interface DemoEntry {
  /** Days before today (0 = today). */
  day: number;
  /** IST wall clock, `HH:MM`. */
  at: string;
  status: LeadStatus;
  note: string;
  /** Next follow-up date, in days after the entry's own date. */
  next?: number;
  /** A manual status change rather than a contact. */
  manual?: boolean;
  /** Who logged it, when not the owner (before a transfer, or an admin). */
  by?: PersonKey;
  /** GPS accuracy in metres for a visit; default is a good fix. */
  accuracy?: number;
}

export interface DemoLead {
  key: string;
  project: ProjectKey;
  owner: PersonKey;
  name: string;
  business: string;
  phone: string;
  location: string;
  notes?: string;
  entries: DemoEntry[];
}

const S = LeadStatus;

export const LEADS: DemoLead[] = [
  // ------------------------------------------------------------ Pune (door-to-door)
  {
    key: 'anil',
    project: 'pune',
    owner: 'ravi',
    name: 'Anil Sharma',
    business: 'Sharma General Stores',
    phone: '9881200101',
    location: 'Wanowrie',
    notes: 'Runs two counters; billing on paper today.',
    entries: [
      {
        day: 12,
        at: '11:20',
        status: S.CONTACTED,
        note: 'Introduced the app at the counter. Owner busy, asked to come back.',
      },
      {
        day: 8,
        at: '16:05',
        status: S.INTERESTED,
        note: 'Showed the GST invoice screen. Liked it, wants to see stock alerts.',
        next: 4,
      },
      {
        day: 4,
        at: '12:40',
        status: S.FOLLOW_UP_SCHEDULED,
        note: 'Demo of stock alerts done. Will decide after talking to his son.',
        next: 4,
      },
    ],
  },
  {
    key: 'meena',
    project: 'pune',
    owner: 'ravi',
    name: 'Meena Joshi',
    business: 'Joshi Medicals',
    phone: '9881200102',
    location: 'Koregaon Park',
    entries: [
      {
        day: 10,
        at: '10:30',
        status: S.CONTACTED,
        note: 'Met the pharmacist; owner Meena available on weekdays.',
        next: 5,
      },
      {
        day: 5,
        at: '15:10',
        status: S.INTERESTED,
        note: 'Interested in batch and expiry tracking.',
        next: 2,
      },
      {
        day: 3,
        at: '11:45',
        status: S.CONVERTED,
        note: 'Signed up for the yearly plan. Paid by UPI.',
      },
    ],
  },
  {
    key: 'farhan',
    project: 'pune',
    owner: 'ravi',
    name: 'Farhan Qureshi',
    business: 'Qureshi Electronics',
    phone: '9881200103',
    location: 'Camp',
    entries: [
      {
        day: 9,
        at: '13:15',
        status: S.CONTACTED,
        note: 'Shop manager took a brochure.',
        next: 3,
        by: 'neha',
      },
      {
        day: 6,
        at: '17:30',
        status: S.INTERESTED,
        note: 'Owner keen; wants EMI billing support.',
        next: 4,
      },
    ],
  },
  {
    key: 'lata',
    project: 'pune',
    owner: 'ravi',
    name: 'Lata Deshpande',
    business: 'Deshpande Sweets',
    phone: '9881200104',
    location: 'Kothrud',
    entries: [
      {
        day: 0,
        at: '10:15',
        status: S.CONTACTED,
        note: 'First visit. Festive rush — come back after Dussehra.',
        next: 3,
      },
    ],
  },
  {
    key: 'rohit',
    project: 'pune',
    owner: 'ravi',
    name: 'Rohit Kulkarni',
    business: 'Kulkarni Hardware',
    phone: '9881200105',
    location: 'Baner',
    entries: [
      {
        day: 5,
        at: '12:05',
        status: S.CONTACTED,
        note: 'Uses Excel for credit customers. Open to a demo.',
        next: 5,
      },
      {
        day: 0,
        at: '11:30',
        status: S.CONVERTED,
        note: 'Converted after the credit-ledger demo. Onboarding tomorrow.',
        accuracy: 180,
      },
    ],
  },
  {
    key: 'sachin',
    project: 'pune',
    owner: 'ravi',
    name: 'Sachin More',
    business: 'More Mobile Shop',
    phone: '9881200106',
    location: 'Hadapsar',
    entries: [
      { day: 6, at: '14:20', status: S.CONVERTED, note: 'Agreed to sign up.' },
      {
        day: 5,
        at: '18:10',
        status: S.INTERESTED,
        note: 'Called the client on a spot-check — not paid yet and still deciding. Reverting.',
        manual: true,
        by: 'priya',
      },
      {
        day: 2,
        at: '16:45',
        status: S.FOLLOW_UP_SCHEDULED,
        note: 'Payment promised next week.',
        next: 3,
      },
    ],
  },
  {
    key: 'sunita',
    project: 'pune',
    owner: 'neha',
    name: 'Sunita Pawar',
    business: 'Pawar Kirana',
    phone: '9881200201',
    location: 'Hadapsar',
    entries: [
      { day: 9, at: '11:00', status: S.CONTACTED, note: 'Small kirana, family-run.', next: 7 },
      {
        day: 2,
        at: '12:30',
        status: S.NOT_INTERESTED,
        note: 'Happy with the free app their supplier gives.',
      },
    ],
  },
  {
    key: 'deepak',
    project: 'pune',
    owner: 'neha',
    name: 'Deepak Jain',
    business: 'Jain Textiles',
    phone: '9881200202',
    location: 'Camp',
    entries: [
      {
        day: 7,
        at: '15:40',
        status: S.INTERESTED,
        note: 'Wants multi-branch stock view for two shops.',
        next: 6,
      },
      {
        day: 1,
        at: '17:15',
        status: S.FOLLOW_UP_SCHEDULED,
        note: 'Will meet with his accountant present.',
        next: 1,
      },
    ],
  },
  {
    key: 'pooja',
    project: 'pune',
    owner: 'neha',
    name: 'Pooja Shinde',
    business: 'Shinde Beauty Parlour',
    phone: '9881200203',
    location: 'Viman Nagar',
    entries: [
      {
        day: 4,
        at: '11:10',
        status: S.CONTACTED,
        note: 'Interested in appointment reminders.',
        next: 1,
      },
      {
        day: 3,
        at: '19:20',
        status: S.CONVERTED,
        note: 'Paid over the phone after the visit.',
        manual: true,
      },
    ],
  },
  {
    key: 'asif',
    project: 'pune',
    owner: 'neha',
    name: 'Asif Khan',
    business: 'Khan Auto Parts',
    phone: '9881200204',
    location: 'Wanowrie',
    entries: [
      {
        day: 15,
        at: '12:00',
        status: S.INTERESTED,
        note: 'Large parts inventory; needs barcode billing.',
        next: 4,
      },
      { day: 11, at: '16:30', status: S.CONVERTED, note: 'Converted. Bought two licences.' },
      {
        day: 2,
        at: '11:50',
        status: S.CONVERTED,
        note: 'After-sale visit: barcode scanner set up, staff trained.',
      },
    ],
  },
  {
    key: 'gaurav',
    project: 'pune',
    owner: 'imran',
    name: 'Gaurav Patil',
    business: 'Patil Dairy',
    phone: '9881200301',
    location: 'Hadapsar',
    entries: [
      {
        day: 3,
        at: '08:40',
        status: S.CONTACTED,
        note: 'Morning visit before the rush. Asked for pricing on WhatsApp.',
        next: 2,
      },
    ],
  },
  {
    key: 'rekha',
    project: 'pune',
    owner: 'imran',
    name: 'Rekha Nair',
    business: 'Nair Bakery',
    phone: '9881200302',
    location: 'Koregaon Park',
    entries: [
      {
        day: 1,
        at: '13:05',
        status: S.INTERESTED,
        note: 'Wants online orders linked to billing.',
        next: 2,
      },
    ],
  },
  {
    key: 'harish',
    project: 'pune',
    owner: 'priya',
    name: 'Harish Bhat',
    business: 'Bhat Opticals',
    phone: '9881200401',
    location: 'Baner',
    entries: [
      { day: 5, at: '15:00', status: S.CONTACTED, note: 'Referred by Asif Khan.', next: 3 },
      { day: 1, at: '12:20', status: S.CONVERTED, note: 'Signed up after a short demo.' },
    ],
  },
  {
    key: 'manoj',
    project: 'pune',
    owner: 'vikram',
    name: 'Manoj Gupta',
    business: 'Gupta Stationers',
    phone: '9881200501',
    location: 'Kothrud',
    entries: [
      {
        day: 20,
        at: '11:30',
        status: S.CONTACTED,
        note: 'Near the college; seasonal business.',
        next: 6,
      },
      {
        day: 14,
        at: '15:45',
        status: S.INTERESTED,
        note: 'Wants a trial before the exam season.',
        next: 4,
      },
    ],
  },
  {
    key: 'kavita',
    project: 'pune',
    owner: 'vikram',
    name: 'Kavita Rane',
    business: 'Rane Florists',
    phone: '9881200502',
    location: 'Viman Nagar',
    entries: [
      {
        day: 18,
        at: '10:10',
        status: S.CONTACTED,
        note: 'Wedding-season orders; billing on WhatsApp.',
        next: 6,
      },
    ],
  },

  // ------------------------------------------------------------ Bangalore (online)
  {
    key: 'ananya',
    project: 'bangalore',
    owner: 'sneha',
    name: 'Ananya Rao',
    business: 'Pixelcraft Studio',
    phone: '9900300101',
    location: 'Indiranagar',
    entries: [
      {
        day: 8,
        at: '11:00',
        status: S.CONTACTED,
        note: 'Intro call. Design studio, 8 people.',
        next: 3,
      },
      {
        day: 5,
        at: '16:30',
        status: S.INTERESTED,
        note: 'Video demo done; asked for the GST invoice template.',
        next: 4,
      },
      { day: 1, at: '12:15', status: S.CONVERTED, note: 'Signed the annual plan.' },
    ],
  },
  {
    key: 'rahul',
    project: 'bangalore',
    owner: 'sneha',
    name: 'Rahul Verma',
    business: 'Verma Logistics',
    phone: '9900300102',
    location: 'Whitefield',
    entries: [
      {
        day: 6,
        at: '14:40',
        status: S.CONTACTED,
        note: 'Call back after their quarterly close.',
        next: 6,
      },
    ],
  },
  {
    key: 'divya',
    project: 'bangalore',
    owner: 'sneha',
    name: 'Divya Menon',
    business: 'BrightPath Tutors',
    phone: '9900300103',
    location: 'Koramangala',
    entries: [
      {
        day: 3,
        at: '18:00',
        status: S.INTERESTED,
        note: 'Needs fee receipts for 120 students.',
        next: 2,
      },
    ],
  },
  {
    key: 'suresh',
    project: 'bangalore',
    owner: 'sneha',
    name: 'Suresh Babu',
    business: 'Babu Traders',
    phone: '9900300104',
    location: 'Jayanagar',
    entries: [
      { day: 12, at: '10:20', status: S.CONTACTED, note: 'Wholesale trader.', next: 2 },
      {
        day: 10,
        at: '11:40',
        status: S.LOST,
        note: 'Went with a competitor bundled with his bank.',
      },
    ],
  },
  {
    key: 'nikhil',
    project: 'bangalore',
    owner: 'karan',
    name: 'Nikhil Shetty',
    business: 'CloudNest Labs',
    phone: '9900300201',
    location: 'HSR Layout',
    entries: [
      {
        day: 4,
        at: '15:15',
        status: S.CONTACTED,
        note: 'Startup; founder handles accounts himself.',
        next: 4,
      },
      {
        day: 0,
        at: '09:45',
        status: S.FOLLOW_UP_SCHEDULED,
        note: 'Wants to see the API integration next week.',
        next: 5,
      },
    ],
  },
  {
    key: 'farah',
    project: 'bangalore',
    owner: 'karan',
    name: 'Farah Siddiqui',
    business: 'Siddiqui Exports',
    phone: '9900300202',
    location: 'Whitefield',
    entries: [
      {
        day: 6,
        at: '12:30',
        status: S.INTERESTED,
        note: 'Needs export invoices in USD as well.',
        next: 3,
      },
      {
        day: 2,
        at: '17:50',
        status: S.CONVERTED,
        note: 'Converted after the multi-currency demo.',
      },
    ],
  },
  {
    key: 'tejas',
    project: 'bangalore',
    owner: 'ravi',
    name: 'Tejas Reddy',
    business: 'Reddy Pharma Distributors',
    phone: '9900300301',
    location: 'Koramangala',
    entries: [
      {
        day: 1,
        at: '19:10',
        status: S.CONTACTED,
        note: 'Referred by a Pune client. Call scheduled.',
        next: 1,
      },
    ],
  },

  // ------------------------------------------------------------ Mumbai (closed)
  {
    key: 'rajesh',
    project: 'mumbai',
    owner: 'karan',
    name: 'Rajesh Iyer',
    business: 'Iyer Caterers',
    phone: '9819900101',
    location: 'Andheri',
    entries: [
      {
        day: 70,
        at: '12:00',
        status: S.CONTACTED,
        note: 'Caterer with monsoon slowdown.',
        next: 7,
      },
      { day: 62, at: '15:30', status: S.CONVERTED, note: 'Converted with the seasonal discount.' },
    ],
  },
  {
    key: 'neeta',
    project: 'mumbai',
    owner: 'karan',
    name: 'Neeta Shah',
    business: 'Shah Garments',
    phone: '9819900102',
    location: 'Bandra',
    entries: [
      {
        day: 55,
        at: '11:15',
        status: S.CONTACTED,
        note: 'Asked to follow up after the sale season.',
        next: 10,
      },
    ],
  },
];

export interface DemoTransfer {
  lead: string;
  from: PersonKey;
  to: PersonKey;
  reason: string;
  day: number;
  at: string;
  decision?: {
    status: 'approved' | 'rejected';
    by: PersonKey | 'superAdmin';
    day: number;
    at: string;
    note?: string;
  };
}

export const TRANSFERS: DemoTransfer[] = [
  {
    lead: 'farhan',
    from: 'neha',
    to: 'ravi',
    reason: 'Ravi covers Camp now; I am moving to Hadapsar.',
    day: 7,
    at: '10:00',
    decision: { status: 'approved', by: 'priya', day: 7, at: '16:00' },
  },
  {
    lead: 'deepak',
    from: 'neha',
    to: 'imran',
    reason: 'Imran speaks Marwari with the owner.',
    day: 3,
    at: '09:30',
    decision: {
      status: 'rejected',
      by: 'priya',
      day: 3,
      at: '12:10',
      note: 'Keep it — you already have the relationship.',
    },
  },
  {
    lead: 'rekha',
    from: 'imran',
    to: 'ravi',
    reason: 'Ravi is in Koregaon Park every morning.',
    day: 0,
    at: '09:05',
  },
  {
    lead: 'divya',
    from: 'sneha',
    to: 'karan',
    reason: 'Education clients are Karan’s segment.',
    day: 1,
    at: '18:30',
  },
  {
    lead: 'neeta',
    from: 'karan',
    to: 'arjun',
    reason: 'Handing over before the campaign ends.',
    day: 40,
    at: '11:00',
    decision: {
      status: 'rejected',
      by: 'superAdmin',
      day: 38,
      at: '18:00',
      note: 'Project closed',
    },
  },
];
