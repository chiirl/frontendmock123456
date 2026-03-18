const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TABLE = process.env.SUPABASE_TABLE || 'beta_chiirl_events';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function haystack(event) {
  return `${event.title || ''} ${(event.tags || []).join(' ')} ${event.location || ''} ${event.eventUrl || ''}`.toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collect(text, rules) {
  const found = [];
  for (const [label, patterns] of rules) {
    if (patterns.some((re) => re.test(text))) found.push(label);
  }
  return unique(found);
}

function withoutNetworkingFallback(activity) {
  if (activity.length <= 1) return activity;
  return activity.filter((value) => value !== 'networking');
}

function classify(event) {
  const text = haystack(event);

  const audience = collect(text, [
    ['invite-only', [/\binvite[- ]only\b/, /\bprivate dinner\b/, /\bregister to see address\b/]],
    ['female founders', [/\bwomen in\b/, /\binternational women'?s day\b/, /\bfemale founder(s)?\b/]],
    ['minority founders', [/\bminority founder(s)?\b/, /\bunderrepresented founder(s)?\b/]],
    ['minority investors', [/\bminority investor(s)?\b/]],
    ['founders', [/\bfounder(s)?\b/, /\bstartup\b/, /\bentrepreneur(s)?\b/]],
    ['investors', [/\binvestor(s)?\b/, /\bventure\b/, /\bvc\b/, /\bangel\b/]],
    ['service-providers', [/\badvisor(s)?\b/, /\bservice provider(s)?\b/, /\bconsultant(s)?\b/, /\blegal\b/, /\btax\b/]],
    ['developers', [/\bdeveloper(s)?\b/, /\bcoding\b/, /\bengineer(s)?\b/, /\.net\b/, /\bdrupal\b/, /\bgrafana\b/, /\bsoftware\b/, /\btest(er|ing)\b/]],
    ['all', [/\bcommunity\b/, /\bmeetup\b/, /\bnetworking\b/, /\bsocial\b/]]
  ]);

  const industry = collect(text, [
    ['AI', [/\bai\b/, /\bclaude\b/, /\banthropic\b/, /\bagent(s)?\b/, /\bllm(s)?\b/]],
    ['climate tech', [/\bclimate\b/, /\bclean tech\b/, /\bclean energy\b/, /\bsustainab/i]],
    ['health', [/\bhealth\b/, /\bhealthcare\b/, /\btherapy\b/, /\bmedical\b/]],
    ['biotech', [/\bbiotech\b/]],
    ['fintech', [/\bfintech\b/, /\bfinancial\b/, /\bfinra\b/, /\bbank(ing)?\b/, /\bpayments?\b/]],
    ['crypto/Web3', [/\bcrypto\b/, /\bweb3\b/, /\bblockchain\b/, /\bdefi\b/]],
    ['cybersecurity', [/\bsecurity\b/, /\bcyber\b/, /\bburbsec\b/]],
    ['data', [/\bdata\b/, /\banalytics\b/, /\bstatistical\b/]],
    ['insurtech', [/\binsurtech\b/, /\binsurance\b/]],
    ['sports', [/\bsports?\b/, /\bcubs\b/]],
    ['future of work', [/\bfuture of work\b/, /\bworkflow(s)?\b/, /\bcustomer success\b/]],
    ['hardtech', [/\bhard tech\b/, /\bmhub\b/, /\binnovation summit\b/]],
    ['legal tech', [/\blegal tech\b/, /\bintellectual property\b/]],
    ['saas', [/\bsaas\b/]],
    ['consumer', [/\bcustomer service\b/, /\bconsumer\b/]]
  ]);

  const topic = collect(text, [
    ['branding', [/\bbranding\b/]],
    ['business strategy', [/\bstrategy\b/, /\bmarket\b/, /\bceo\b/, /\badoption\b/]],
    ['capital deployment', [/\bventure\b/, /\bvc\b/, /\binvestor(s)?\b/]],
    ['coding', [/\bcoding\b/, /\bbuild with\b/, /\.net\b/, /\bgrafana\b/, /\bdrupal\b/, /\bobservability\b/, /\bevals\b/, /\bsoftware\b/]],
    ['finance', [/\bfinancial\b/, /\bfinra\b/, /\btax\b/]],
    ['fundraising', [/\bfundraising\b/, /\bpitch\b/, /1 million cups/i]],
    ['GTM', [/\bgtm\b/, /\bgo-to-market\b/]],
    ['legal\/IP', [/\blegal\b/, /\bip\b/, /\bintellectual property\b/]],
    ['marketing', [/\bmarketing\b/]],
    ['organization management', [/\bleadership\b/, /\bcommunication\b/, /\bmanagement\b/]],
    ['policy', [/\bpolicy\b/]],
    ['product', [/\bproduct\b/, /\bux\b/, /\bui\b/, /\bcustomer success\b/]],
    ['recruiting', [/\brecruit/i]],
    ['sales', [/\bsales\b/]],
    ['scaling', [/\bscale\b/, /\bmaturity\b/, /\bgrowth\b/]],
    ['UIUX/CX', [/\bux\b/, /\bui\b/, /\bcx\b/]]
  ]);

  const activity = withoutNetworkingFallback(
    collect(text, [
      ['co-working', [/\bcowork/i, /\bco-working\b/]],
      ['discussion', [/\bdiscussion\b/, /\btherapy\b/, /\bmeeting\b/, /\broundtable\b/]],
      ['hangout event', [/\bhangout\b/, /\bopen house\b/, /\bhappy hour\b/, /\bsocial\b/]],
      ['networking', [/\bnetworking\b/, /\bmixer\b/, /\bconnect\b/, /\bmeetup\b/, /\bcommunity\b/]],
      ['pitching or demo', [/\bpitch\b/, /\bdemo\b/, /1 million cups/i]],
      ['speaker panel or fireside', [/\bpanel\b/, /\bfireside\b/, /\bsummit\b/, /\bq&a\b/]]
    ])
  );

  return { audience, industry, topic, activity };
}

async function main() {
  for (const column of ['audience', 'industry', 'topic', 'activity']) {
    const { error } = await supabase.from(TABLE).select(column).limit(1);
    if (error) throw new Error(`Missing ${column} column on ${TABLE}.`);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('id,title,tags,location,eventUrl')
    .order('id', { ascending: true });
  if (error) throw error;

  const updates = data.map((event) => ({
    id: event.id,
    ...classify(event)
  }));

  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const { error: upsertError } = await supabase.from(TABLE).upsert(batch, { onConflict: 'id' });
    if (upsertError) throw upsertError;
    console.log(`Updated ${Math.min(i + batch.length, updates.length)} / ${updates.length}`);
  }

  console.log(`Backfilled taxonomy for ${updates.length} rows.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
