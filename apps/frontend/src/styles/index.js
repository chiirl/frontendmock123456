const fs = require('fs');
const path = require('path');

function loadCSS(filename) {
  return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

const MODERN_STYLES = loadCSS('modern.css');
const LOGO_STYLES = loadCSS('logo.css');
const BASE_STYLES = loadCSS('base.css');
const CLASSIC_PAGE_STYLES = loadCSS('classic.css');
const EVENT_DETAIL_STYLES = loadCSS('event-detail.css');
const ARCHIVE_STYLES = loadCSS('archive.css');
const RAW_TABLE_STYLES = loadCSS('raw-table.css');

module.exports = {
  MODERN_STYLES,
  LOGO_STYLES,
  BASE_STYLES,
  CLASSIC_PAGE_STYLES,
  EVENT_DETAIL_STYLES,
  ARCHIVE_STYLES,
  RAW_TABLE_STYLES
};
