const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseWriteKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !supabaseWriteKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseWriteKey);
const table = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

const events = [
  {
    title: 'AI Builder Hackathon',
    start_datetime: '2026-03-14T10:00:00.000-05:00',
    Online: 'FALSE',
    tech_category: 'AI',
    image_url: 'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=75,width=500,height=500/event-covers/qq/3d25e67b-ec61-4313-8aac-87761f777445.jpg',
    eventUrl: 'https://luma.com/b9zxqzsg',
    location: '1834 Walden Office Square, Schaumburg, Illinois',
    google_maps_url: null
  },
  {
    title: "Vibecoding Hackathon w/ Google's DeepMind",
    start_datetime: '2026-03-14T11:00:00.000-05:00',
    Online: 'FALSE',
    tech_category: 'AI',
    image_url: 'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=75,width=500,height=500/event-covers/js/4134e14f-98f1-463d-a56f-c345cd277e87.png',
    eventUrl: 'https://luma.com/lwgsc6ew',
    location: 'Chicago, Illinois (register to see address)',
    google_maps_url: null
  },
  {
    title: 'The AI Reality Check: What Actually Delivers in Healthcare',
    start_datetime: '2026-03-19T16:00:00.000-05:00',
    Online: 'FALSE',
    tech_category: 'AI',
    image_url: 'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=75,width=500,height=500/event-covers/hp/ba643020-d45a-4954-8bf6-d9c3274d633b.png',
    eventUrl: 'https://luma.com/eqcdysi0',
    location: 'Atomic Object, Chicago, Illinois',
    google_maps_url: null
  },
  {
    title: 'Chicago | Claude Code for HealthTech',
    start_datetime: '2026-03-19T17:30:00.000-05:00',
    Online: 'FALSE',
    tech_category: 'AI',
    image_url: 'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=75,width=500,height=500/event-covers/82/74ab1757-cf82-4550-8bc1-8ec15f7d474a.png',
    eventUrl: 'https://luma.com/s0pc2wz3',
    location: 'Chicago, Illinois (register to see address)',
    google_maps_url: null
  },
  {
    title: 'Chicago Grassroots Tech Community Meetup - March',
    start_datetime: '2026-03-19T17:30:00.000-05:00',
    Online: 'FALSE',
    tech_category: 'Tech',
    image_url: 'https://images.unsplash.com/photo-1549533948-77ab8a0d9878?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&ixid=M3wxMjQyMjF8MHwxfHNlYXJjaHwxMXx8Y2hpY2Fnb3xlbnwwfHx8fDE3NjUwNzg4ODR8Mg&ixlib=rb-4.1.0&q=80&w=1000&h=1000',
    eventUrl: 'https://luma.com/c2xrrc7r',
    location: 'Chicago, Illinois (register to see address)',
    google_maps_url: null
  }
];

async function run() {
  const { data, error } = await supabase
    .from(table)
    .insert(events)
    .select('title,start_datetime,eventUrl,tech_category,image_url,location');

  if (error) {
    console.error('INSERT_ERROR:', error.message);
    process.exit(1);
  }

  const urls = events.map((e) => e.eventUrl);
  const { data: verify, error: verifyError } = await supabase
    .from(table)
    .select('title,start_datetime,eventUrl,tech_category')
    .in('eventUrl', urls)
    .order('start_datetime', { ascending: true });

  if (verifyError) {
    console.error('VERIFY_ERROR:', verifyError.message);
    process.exit(1);
  }

  console.log('Inserted rows:', data.length);
  console.log('Verified rows now in table:', verify.length);
  for (const row of verify) {
    console.log(`- ${row.start_datetime} | ${row.tech_category} | ${row.title} | ${row.eventUrl}`);
  }
}

run();
