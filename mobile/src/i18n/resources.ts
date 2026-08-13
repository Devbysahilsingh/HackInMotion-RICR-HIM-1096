/**
 * Canonical translation resources, imported straight from `shared/i18n`
 * (ADR-018 — one source, no per-surface fork). Metro inlines the JSON at
 * bundle time via the `@shared` alias declared in metro.config.js, so there is
 * no runtime fetch and no loading state for text — which also means the app's
 * copy works with the network off.
 *
 * The namespace list is closed and identical to the web's
 * (web/frontend/src/i18n/resources.ts): if a key is missing here it is missing
 * there too, and `scripts/check-i18n.mjs` fails the build for both.
 */
import enAgri from '@shared/i18n/en/agri.json';
import enAuth from '@shared/i18n/en/auth.json';
import enCommon from '@shared/i18n/en/common.json';
import enCommunity from '@shared/i18n/en/community.json';
import enCrop from '@shared/i18n/en/crop.json';
import enCropRec from '@shared/i18n/en/cropRec.json';
import enDisease from '@shared/i18n/en/disease.json';
import enErrors from '@shared/i18n/en/errors.json';
import enFarm from '@shared/i18n/en/farm.json';
import enFertilizer from '@shared/i18n/en/fertilizer.json';
import enHealth from '@shared/i18n/en/health.json';
import enIrrigation from '@shared/i18n/en/irrigation.json';
import enLanding from '@shared/i18n/en/landing.json';
import enMarket from '@shared/i18n/en/market.json';
import enMobile from '@shared/i18n/en/mobile.json';
import enVoice from '@shared/i18n/en/voice.json';
import enWeather from '@shared/i18n/en/weather.json';

import hiAgri from '@shared/i18n/hi/agri.json';
import hiAuth from '@shared/i18n/hi/auth.json';
import hiCommon from '@shared/i18n/hi/common.json';
import hiCommunity from '@shared/i18n/hi/community.json';
import hiCrop from '@shared/i18n/hi/crop.json';
import hiCropRec from '@shared/i18n/hi/cropRec.json';
import hiDisease from '@shared/i18n/hi/disease.json';
import hiErrors from '@shared/i18n/hi/errors.json';
import hiFarm from '@shared/i18n/hi/farm.json';
import hiFertilizer from '@shared/i18n/hi/fertilizer.json';
import hiHealth from '@shared/i18n/hi/health.json';
import hiIrrigation from '@shared/i18n/hi/irrigation.json';
import hiLanding from '@shared/i18n/hi/landing.json';
import hiMarket from '@shared/i18n/hi/market.json';
import hiMobile from '@shared/i18n/hi/mobile.json';
import hiVoice from '@shared/i18n/hi/voice.json';
import hiWeather from '@shared/i18n/hi/weather.json';

export const NAMESPACES = [
  'common',
  'auth',
  'farm',
  'crop',
  'health',
  'weather',
  'irrigation',
  'landing',
  'market',
  'fertilizer',
  'cropRec',
  'community',
  'voice',
  'errors',
  'agri',
  'disease',
  /**
   * Mobile-only surface copy: permission rationales, camera guidance, the
   * offline banner, tab labels. It exists because these strings have no web
   * counterpart to share — a browser never asks for the camera permission in
   * these words. Web-shared copy stays in the namespaces above.
   */
  'mobile',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    farm: enFarm,
    crop: enCrop,
    health: enHealth,
    weather: enWeather,
    irrigation: enIrrigation,
    landing: enLanding,
    market: enMarket,
    fertilizer: enFertilizer,
    cropRec: enCropRec,
    community: enCommunity,
    voice: enVoice,
    errors: enErrors,
    agri: enAgri,
    disease: enDisease,
    mobile: enMobile,
  },
  hi: {
    common: hiCommon,
    auth: hiAuth,
    farm: hiFarm,
    crop: hiCrop,
    health: hiHealth,
    weather: hiWeather,
    irrigation: hiIrrigation,
    landing: hiLanding,
    market: hiMarket,
    fertilizer: hiFertilizer,
    cropRec: hiCropRec,
    community: hiCommunity,
    voice: hiVoice,
    errors: hiErrors,
    agri: hiAgri,
    /**
     * 408/408 present, translated from the sourced English — but
     * machine-translated and NOT yet signed off by a Hindi-literate reviewer
     * (`shared/i18n/hi/_verification.json`: disease `verifiedBy: "claude"`).
     */
    disease: hiDisease,
    mobile: hiMobile,
  },
} as const;
