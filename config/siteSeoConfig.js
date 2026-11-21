'use strict';

const siteSeoConfig = Object.freeze({
  siteName: process.env.SITE_NAME || 'Anannt Urjaa',
  siteLocale: process.env.SITE_LOCALE || 'en-IN',
  organizationName: process.env.ORGANIZATION_NAME || process.env.SITE_NAME || 'Anannt Urjaa',
  logoUrl: process.env.SITE_LOGO_URL || '/images/footer_logo1.svg',
  twitterSite: process.env.TWITTER_SITE || '',
  defaultDescription:
    process.env.SITE_DEFAULT_DESCRIPTION ||
    'PEMF therapy, wellness programs, and recovery insights from Anannt Urjaa.',
});

module.exports = { siteSeoConfig };