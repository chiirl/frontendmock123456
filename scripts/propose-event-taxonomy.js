const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'Event_Tags_rows.csv');
const TABLE = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  const [header, ...body] = rows;
  return body.map((cols) =>
    Object.fromEntries(header.map((key, idx) => [key, (cols[idx] || '').trim()]))
  );
}

function normalizeValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^Al$/i, 'AI');
}

function loadVocabulary() {
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  return {
    audience: [...new Set(rows.map((r) => normalizeValue(r.AUDIENCE)).filter(Boolean))],
    industry: [...new Set(rows.map((r) => normalizeValue(r.INDUSTRY)).filter(Boolean))],
    topic_activity: [...new Set(rows.map((r) => normalizeValue(r['TOPIC / ACTIVITY'])).filter(Boolean))],
    stage: [...new Set(rows.map((r) => normalizeValue(r.STAGE)).filter(Boolean))]
  };
}

function eventHaystack(event) {
  return `${event.title || ''} ${(event.tags || []).join(' ')} ${event.location || ''} ${event.eventUrl || ''}`.toLowerCase();
}

function isUpcoming(event, now = new Date()) {
  const date = new Date(event.start_datetime);
  return !Number.isNaN(date.getTime()) && date >= now;
}

function isChicagoAreaEvent(event) {
  const hay = eventHaystack(event);
  const chicagoHints = [
    'chicago',
    'naperville',
    'evanston',
    'fulton',
    'river north',
    'merchandise mart',
    'lincoln ave',
    'wacker',
    'van buren',
    'peoria',
    'elston',
    'milwaukee ave',
    'armitage'
  ];
  const foreignHints = ['paris', "rue d'uz", 'ile-de-france'];
  if (foreignHints.some((hint) => hay.includes(hint))) return false;
  if (chicagoHints.some((hint) => hay.includes(hint))) return true;
  if ((event.location || '').toLowerCase().includes('online')) return true;
  return /meetup\.com|mhubchicago\.com|eventbrite\.com/.test(hay);
}

function matchLabel(hay, rules, fallback = null) {
  for (const [label, patterns] of rules) {
    if (patterns.some((re) => re.test(hay))) return label;
  }
  return fallback;
}

function inferAudience(event) {
  const hay = eventHaystack(event);
  return matchLabel(hay, [
    ['invite-only', [/\binvite[- ]only\b/, /\bprivate dinner\b/, /\bregister to see address\b/]],
    ['female founders', [/\bwomen in\b/, /\binternational women'?s day\b/, /\bfemale founder(s)?\b/]],
    ['minority founders', [/\bminority founder(s)?\b/, /\bunderrepresented founder(s)?\b/]],
    ['minority investors', [/\bminority investor(s)?\b/]],
    ['founders, investors', [/\bfounder(s)?\b.*\binvestor(s)?\b/, /\binvestor(s)?\b.*\bfounder(s)?\b/]],
    ['investors', [/\binvestor(s)?\b/, /\bventure\b/, /\bvc\b/, /\bangel\b/]],
    ['service-providers', [/\badvisor(s)?\b/, /\bservice provider(s)?\b/, /\bconsultant(s)?\b/, /\blegal\b/, /\btax\b/]],
    ['developers', [/\bdeveloper(s)?\b/, /\bcoding\b/, /\bengineer(s)?\b/, /\.net\b/, /\bdrupal\b/, /\bgrafana\b/, /\bopen source\b/]],
    ['founders', [/\bfounder(s)?\b/, /\bstartup\b/, /\bentrepreneur(s)?\b/]]
  ], 'all');
}

function inferIndustry(event) {
  const hay = eventHaystack(event);
  return matchLabel(hay, [
    ['AI', [/\bai\b/, /\bclaude\b/, /\banthropic\b/, /\bagent(s)?\b/, /\bllm(s)?\b/]],
    ['climate tech', [/\bclimate\b/, /\bclean tech\b/, /\bclean energy\b/, /\bdecarbon/i, /\bsustainab/i]],
    ['cleantech', [/\bcleantech\b/]],
    ['health', [/\bhealth\b/, /\bhealthcare\b/, /\btherapy\b/, /\bmedical\b/]],
    ['biotech', [/\bbiotech\b/, /\bbio\b/]],
    ['fintech', [/\bfintech\b/, /\bfinancial\b/, /\bfinra\b/, /\bbank(ing)?\b/, /\bpayments?\b/]],
    ['crypto/Web3', [/\bcrypto\b/, /\bweb3\b/, /\bblockchain\b/, /\bdefi\b/]],
    ['cybersecurity', [/\bsecurity\b/, /\bcyber\b/, /\bburbsec\b/]],
    ['data', [/\bdata\b/, /\banalytics\b/, /\bstatistical\b/]],
    ['insurtech', [/\binsurtech\b/, /\binsurance\b/]],
    ['sports', [/\bsports?\b/, /\bcubs\b/]],
    ['future of work', [/\bfuture of work\b/, /\bworkflow(s)?\b/, /\bcustomer success\b/]],
    ['hardtech', [/\bhard tech\b/, /\bmhub\b/, /\binnovation summit\b/]],
    ['legal tech', [/\blegal tech\b/, /\bip\b/, /\bintellectual property\b/]],
    ['saas', [/\bsaas\b/]],
    ['consumer', [/\bcustomer service\b/, /\bconsumer\b/]]
  ]);
}

function inferTopic(event) {
  const hay = eventHaystack(event);
  return matchLabel(hay, [
    ['activity: co-working', [/\bcowork/i, /\bco-working\b/]],
    ['activity: networking', [/\bnetworking\b/, /\bmixer\b/, /\bhappy hour\b/, /\bsocial\b/, /\bconnect\b/]],
    ['activity: speaker panel or fireside', [/\bpanel\b/, /\bfireside\b/, /\broundtable\b/, /\bq&a\b/, /\bsummit\b/]],
    ['activity: discussion', [/\bdiscussion\b/, /\btherapy\b/, /\bmeet(ing)?\b/]],
    ['activity: hangout event', [/\bhangout\b/, /\bopen house\b/]],
    ['activity: pitching or demo', [/\bpitch\b/, /\bdemo\b/, /1 million cups/i]],
    ['coding', [/\bcoding\b/, /\bbuild with\b/, /\.net\b/, /\bgrafana\b/, /\bdrupal\b/, /\btest(er|ing)\b/]],
    ['fundraising', [/\bfundraising\b/, /\binvestor(s)?\b/, /\bcapital\b/]],
    ['capital deployment', [/\bventure\b/, /\bvc\b/, /\binvestor(s)?\b/]],
    ['finance', [/\bfinancial\b/, /\bfinra\b/, /\btax\b/]],
    ['business strategy', [/\bstrategy\b/, /\bmarket\b/, /\badvisor(s)?\b/, /\bceo\b/]],
    ['organization management', [/\bleadership\b/, /\bcommunication\b/, /\bmanagement\b/]],
    ['product', [/\bproduct\b/, /\bux\b/, /\bui\b/, /\bcustomer success\b/]],
    ['sales', [/\bsales\b/]],
    ['policy', [/\bpolicy\b/]],
    ['legal/IP', [/\blegal\b/, /\bip\b/, /\bintellectual property\b/]],
    ['scaling', [/\bscale\b/, /\bmaturity\b/, /\bgrowth\b/]],
    ['recruiting', [/\brecruit/i]],
    ['marketing', [/\bmarketing\b/, /\bbranding\b/]],
    ['GTM', [/\bgtm\b/, /\bgo-to-market\b/]],
    ['UIUX/CX', [/\bux\b/, /\bui\b/, /\bcx\b/]]
  ]);
}

function inferStage(event) {
  const hay = eventHaystack(event);
  return matchLabel(hay, [
    ['concept', [/\bidea stage\b/, /\bconcept\b/]],
    ['pre-seed', [/\bpre-seed\b/]],
    ['seed', [/\bseed\b/]],
    ['series A', [/\bseries a\b/]],
    ['late stage', [/\blate stage\b/, /\benterprise\b/]],
    ['early stage (angel, pre-seed, seed)', [/\bearly stage\b/, /\bangel\b/]],
    ['all', [/\ball stages\b/, /1 million cups/i]]
  ], 'unknown');
}

function confidenceFor(proposal) {
  const populated = ['audience', 'industry', 'topic_activity', 'stage'].filter(
    (key) => proposal[key] && proposal[key] !== 'unknown' && proposal[key] !== 'all'
  ).length;
  if (populated >= 3) return 'high';
  if (populated >= 2) return 'medium';
  return 'low';
}

async function main() {
  const vocab = loadVocabulary();
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from(TABLE)
    .select('id,title,start_datetime,tags,location,eventUrl')
    .order('start_datetime', { ascending: true })
    .limit(1000);
  if (error) throw error;

  const upcomingChicago = (data || []).filter((event) => isUpcoming(event) && isChicagoAreaEvent(event));
  const proposals = upcomingChicago.map((event) => {
    const proposal = {
      id: event.id,
      title: event.title,
      start_datetime: event.start_datetime,
      existing_tags: event.tags || [],
      audience: inferAudience(event),
      industry: inferIndustry(event),
      topic_activity: inferTopic(event),
      stage: inferStage(event)
    };
    return { ...proposal, confidence: confidenceFor(proposal) };
  });

  const counts = {};
  for (const key of ['audience', 'industry', 'topic_activity', 'stage']) {
    counts[key] = proposals.reduce((acc, row) => {
      const label = row[key] || '(blank)';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
  }

  console.log(
    JSON.stringify(
      {
        table: TABLE,
        vocabulary: vocab,
        upcomingChicagoCount: upcomingChicago.length,
        counts,
        proposals
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
