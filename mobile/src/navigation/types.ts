/**
 * Navigation shape, per docs/mobile/navigation.md.
 *
 * Four tabs, because the product is four questions — what should I do today
 * (Home), is my crop sick (Scan), what is it worth (Market), and what is on my
 * land (Farm). Settings is reached from the Home header rather than taking a
 * fifth tab: a farmer opens it once and never again, and a tab bar is scarce.
 *
 * Every param list is declared here rather than beside its navigator so a
 * screen can type its props without importing the navigator that renders it —
 * which would be a cycle.
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  LanguageIntro: undefined;
  Login: undefined;
  Register: undefined;
};

export type HomeStackParamList = {
  Dashboard: undefined;
  RecommendationDetail: { recommendationId: string };
  Settings: undefined;
  History: undefined;
  HistoryDetail: { logId: string };
  CropRecommendation: { farmId?: string } | undefined;
  Community: undefined;
};

/** The tabs on the crop screen; also what a feed item can deep-link to. */
export type CropDetailTab = 'irrigation' | 'health' | 'fertilizer' | 'market';

export type FarmStackParamList = {
  FarmList: undefined;
  FarmForm: { farmId?: string } | undefined;
  FarmDetail: { farmId: string };
  CropForm: { farmId: string };
  /**
   * `tab` lets a dashboard item open the answer it was about — an irrigation
   * recommendation should land on the irrigation tab, not on whichever one
   * happens to be first.
   */
  CropDetail: { cropId: string; tab?: CropDetailTab };
  Weather: { farmId: string };
};

export type ScanStackParamList = {
  CropPick: undefined;
  Camera: { cropId: string };
  /**
   * `imageUri` is a local file path, not an upload id: the analysing screen
   * owns the upload, so a mid-flight failure can retry from the same bytes
   * without sending the farmer back to the camera (RES-10).
   */
  Analyzing: {
    cropId: string;
    imageUri: string;
    shareToCommunity?: boolean;
    /**
     * What the farmer typed about what they are seeing. The API accepts it and
     * the AI tier uses it, so leaving it unwired would throw away the one piece
     * of context a photograph cannot carry.
     */
    description?: string;
  };
  AnalysisResult: { logId: string };
  SymptomChecklist: { cropId: string };
};

export type MarketStackParamList = {
  MarketOverview: undefined;
  CommodityDetail: { commodity: string; state?: string; district?: string };
};

export type MainTabsParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  ScanTab: NavigatorScreenParams<ScanStackParamList>;
  MarketTab: NavigatorScreenParams<MarketStackParamList>;
  FarmTab: NavigatorScreenParams<FarmStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabsParamList>;
};

/**
 * Registers the param lists globally so `useNavigation()` is typed without
 * every call site restating the generic.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
