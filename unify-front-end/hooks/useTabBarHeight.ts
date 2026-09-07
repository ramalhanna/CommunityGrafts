import { Platform } from 'react-native';
import { useBottomTabBarHeight as useJsBottomTabBarHeight } from '@react-navigation/bottom-tabs';

// On iOS we render NativeTabs (UITabBar), so @react-navigation/bottom-tabs'
// useBottomTabBarHeight throws — there is no JS tab navigator to measure.
// iOS 26's Liquid Glass tab bar floats with its own bottom margin clearing
// the home indicator, so we only pad for the pill's visual obstruction
// (empirically ~80pt with a small breathing gap). Adding the bottom
// safe-area inset on top would double-count.
const useIOSTabBarHeight = (): number => 80;

// Platform.OS is determined at module load and never changes within a session,
// so the exported hook reference is stable — no rules-of-hooks violation.
export const useTabBarHeight =
  Platform.OS === 'ios' ? useIOSTabBarHeight : useJsBottomTabBarHeight;
