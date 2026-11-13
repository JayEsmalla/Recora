import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

/**
 * A brief native-driven emphasis on changed content. Reduced-motion settings
 * take precedence, and the content is always present for assistive technology.
 */
export function useAccessibleFade(changeKey: string): Animated.Value {
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // Unknown accessibility setting: keep the conservative no-motion default.
      });
    const listener = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      active = false;
      listener.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.93);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [changeKey, opacity, reduceMotion]);

  return opacity;
}
