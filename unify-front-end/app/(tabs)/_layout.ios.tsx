import React, { useEffect, useRef } from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { HIDDEN_TAB_BAR_ROUTES } from '@/constants/Routes';
import { useAnalytics } from '@/utils/analytics';
import { useHapticsPreference } from '@/context/HapticsContext';

const getCurrentTabFromPath = (path: string): string | null => {
  if (path.startsWith('/Gather')) return 'Gather';
  if (path.startsWith('/companion')) return 'companion';
  if (path.startsWith('/Checklist')) return 'Checklist';
  if (path.startsWith('/Learn')) return 'Learn';
  if (path.startsWith('/Social')) return 'Social';
  return null;
};

// Stable, locale-independent labels for analytics so PostHog event values
// don't fragment by user language.
const getTabAnalyticsLabel = (routeName: string) => {
  switch (routeName) {
    case 'Social':
      return 'Social';
    case 'Gather':
      return 'Community';
    case 'companion':
      return 'Companion';
    case 'Checklist':
      return 'Checklist';
    case 'Learn':
      return 'Learn';
    default:
      return routeName;
  }
};

export default function TabLayout() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { trackTabSwitch } = useAnalytics();
  const { hapticsEnabled } = useHapticsPreference();
  const prevTabRef = useRef<string | null>(null);

  const isTabBarHidden = HIDDEN_TAB_BAR_ROUTES.some(route =>
    pathname.includes(route)
  );

  // NativeTabs has no tabPress listener. Watch the pathname's tab segment
  // and fire haptic + analytics whenever the active tab changes. Ignore
  // navigations to non-tab routes (e.g. /post-details) so we don't fire
  // phantom switches when the user opens an inner screen.
  useEffect(() => {
    const currentTab = getCurrentTabFromPath(pathname);
    if (!currentTab) return;
    const prevTab = prevTabRef.current;
    if (prevTab && prevTab !== currentTab) {
      if (hapticsEnabled) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      trackTabSwitch(
        getTabAnalyticsLabel(prevTab),
        getTabAnalyticsLabel(currentTab)
      );
    }
    prevTabRef.current = currentTab;
  }, [pathname, hapticsEnabled, trackTabSwitch]);

  return (
    <NativeTabs hidden={isTabBarHidden}>
      <NativeTabs.Trigger name='index' hidden />
      <NativeTabs.Trigger name='Learn'>
        <NativeTabs.Trigger.Icon sf='book.closed' />
        <NativeTabs.Trigger.Label>{t('tabs.learn')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='Checklist'>
        <NativeTabs.Trigger.Icon sf='checklist' />
        <NativeTabs.Trigger.Label>
          {t('tabs.checklist')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='companion'>
        <NativeTabs.Trigger.Icon sf='sparkles' />
        <NativeTabs.Trigger.Label>
          {t('tabs.companion')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='Gather'>
        <NativeTabs.Trigger.Icon sf='person.2' />
        <NativeTabs.Trigger.Label>
          {t('tabs.community')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='Social'>
        <NativeTabs.Trigger.Icon sf='newspaper' />
        <NativeTabs.Trigger.Label>{t('tabs.social')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
