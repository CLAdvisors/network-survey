const BRAND_COLORS = {
  primary: '#42B4AF',
  primaryDashboard: '#42B3AF',
  primaryHover: '#3B9F9B',
  alertAccent: '#31C9A6',
  textPrimary: '#333',
  backgroundDefault: '#f9f9f9',
  surveyBackground: '#F9F9F9'
};

const BRAND = {
  dashboardTitle: 'CLA Survey Dashboard',
  websiteUrl: 'https://contemporaryleadership.com/',
  faviconUrl: 'https://contemporaryleadership.com/wp-content/uploads/2021/09/favicon.svg'
};

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ko', label: 'Korean' }
];

const TAGBOX_PLACEHOLDER = 'Start typing to search for people';
const TAGBOX_PAGE_SIZE = 25;

module.exports = {
  BRAND,
  BRAND_COLORS,
  LANGUAGES,
  TAGBOX_PLACEHOLDER,
  TAGBOX_PAGE_SIZE
};
