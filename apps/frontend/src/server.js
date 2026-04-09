const path = require('path');
const express = require('express');

const { supabase, EVENTS_TABLE_NAME } = require('./db');
const { formatChiirlTimeShort, formatChicagoDateTime } = require('./utils/dates');
const {
  buildUrl,
  parseFilterList,
  serializeFilterList,
  encodeFilterValues,
  buildFilterOptions,
  renderTaxonomyList
} = require('./utils/format');
const {
  MODERN_STYLES,
  LOGO_STYLES,
  BASE_STYLES,
  CLASSIC_PAGE_STYLES,
  EVENT_DETAIL_STYLES,
  ARCHIVE_STYLES,
  RAW_TABLE_STYLES
} = require('./styles');
const { deduplicateEvents, filterUpcoming } = require('./utils/events');
const { prepareModernViewData } = require('./views/modern');
const { buildEmailDraft } = require('./views/email');
const { buildCalendarModel } = require('./views/calendar');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Make helpers and styles available to all EJS templates
app.locals.buildUrl = buildUrl;
app.locals.formatChicagoDateTime = formatChicagoDateTime;
app.locals.formatChiirlTimeShort = formatChiirlTimeShort;
app.locals.encodeFilterValues = encodeFilterValues;
app.locals.renderTaxonomyList = renderTaxonomyList;
app.locals.MODERN_STYLES = MODERN_STYLES;
app.locals.LOGO_STYLES = LOGO_STYLES;
app.locals.BASE_STYLES = BASE_STYLES;
app.locals.CLASSIC_PAGE_STYLES = CLASSIC_PAGE_STYLES;
app.locals.EVENT_DETAIL_STYLES = EVENT_DETAIL_STYLES;
app.locals.ARCHIVE_STYLES = ARCHIVE_STYLES;
app.locals.RAW_TABLE_STYLES = RAW_TABLE_STYLES;

function getView(req) {
  if (req.path === '/email') return 'email';
  if (req.path.startsWith('/calendar')) return 'calendar';
  return 'events';
}

app.get('/logo.png', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../../Logo_on_light_bg.png'));
});

app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get(['/', '/email', '/calendar/:month?'], async (req, res) => {
  const view = getView(req);
  const monthParam = String(req.params.month || '');
  const audienceFilter = parseFilterList(req.query.audience);
  const industryFilter = parseFilterList(req.query.industry);
  const topicFilter = parseFilterList(req.query.topic);
  const activityFilter = parseFilterList(req.query.activity);
  const modeFilter = parseFilterList(req.query.mode);
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const allDeduped = deduplicateEvents(events);
  const deduped = deduplicateEvents(filterUpcoming(events));

  const audienceOptions = buildFilterOptions(deduped, 'audience');
  const industryOptions = buildFilterOptions(deduped, 'industry');
  const topicOptions = buildFilterOptions(deduped, 'topic');
  const activityOptions = buildFilterOptions(deduped, 'activity');
  const calendar = buildCalendarModel(allDeduped, monthParam);
  const currentFilters = {
    audience: serializeFilterList(audienceFilter),
    industry: serializeFilterList(industryFilter),
    topic: serializeFilterList(topicFilter),
    activity: serializeFilterList(activityFilter),
    mode: serializeFilterList(modeFilter)
  };

  if (view === 'events' && req.query.view === 'modern') {
    const { days, filterGroups } = prepareModernViewData(deduped, audienceOptions, industryOptions, topicOptions, activityOptions);
    const toggleUrl = buildUrl('/', currentFilters);
    return res.render('modern', { days, filterGroups, currentFilters, toggleUrl });
  }

  if (view === 'events') {
    return res.render('events', {
      view, currentFilters, calendar, deduped,
      audienceOptions, industryOptions, topicOptions, activityOptions,
      audienceFilter, industryFilter, topicFilter, activityFilter, modeFilter
    });
  }

  if (view === 'email') {
    const emailDraftText = buildEmailDraft(allDeduped);
    return res.render('email', { view, currentFilters, calendar, emailDraftText });
  }

  // calendar view
  res.render('calendar', { view, currentFilters, calendar });
});

app.get('/email.txt', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const allDeduped = deduplicateEvents(events || []);
  res.type('text/plain').send(buildEmailDraft(allDeduped));
});

app.get('/event', async (req, res) => {
  const { title, date } = req.query;
  if (!title) return res.status(400).send('Missing title');

  let query = supabase.from(EVENTS_TABLE_NAME).select('*').eq('title', title);
  if (date) query = query.eq('start_datetime', date);
  const { data, error } = await query;

  if (error) return res.status(500).send('Error loading event');
  const event = data && data[0];
  if (!event) return res.status(404).send('Event not found');

  const fields = Object.entries(event).filter(([, v]) => v != null && v !== '');
  res.render('event-detail', { event, fields });
});

app.get('/archive', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*')
    .order('start_datetime', { ascending: false });

  if (error) return res.status(500).send('Error loading events');
  res.render('archive', { events });
});

app.get('/raw', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const cols = Object.keys(events[0] || {});
  res.render('raw', { events, cols });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
