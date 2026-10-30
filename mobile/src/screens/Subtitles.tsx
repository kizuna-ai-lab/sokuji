import { FlatList, Text as Span, useWindowDimensions, View } from 'react-native';
import type { Entry } from '@shared/lib/projection/types';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { lineHeight, SIZES, SOURCE_MAX_SCALE, TRANSLATION_MAX_SCALE } from '@/lib/subtitleText';
import { leadTrimmed } from '@/lib/spans';
import { scaledLine } from './subtitleSize';

// Scrolled back further than this, a new line does not pull the list down to it.
const FOLLOW_WITHIN = 48;

export default function Subtitles({
  entries,
  bilingual,
  textSize,
}: {
  /** Newest first: the list is inverted, so the newest sits at the bottom. */
  entries: readonly Entry[];
  bilingual: boolean;
  textSize: keyof typeof SIZES;
}) {
  const size = SIZES[textSize];
  const { fontScale } = useWindowDimensions();
  const source = scaledLine(size.source, lineHeight(size.source), fontScale, SOURCE_MAX_SCALE);
  const translation = scaledLine(size.translation, lineHeight(size.translation), fontScale, TRANSLATION_MAX_SCALE);
  // text-sm: 14 on 20.
  const notice = scaledLine(14, 20, fontScale, SOURCE_MAX_SCALE);
  return (
    <FlatList
      className="w-full flex-1"
      data={entries}
      inverted
      keyExtractor={(e) => e.id}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={5}
      removeClippedSubviews
      // Reading older lines: they stay where they are as new ones arrive below.
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: FOLLOW_WITHIN }}
      renderItem={({ item }) =>
        item.kind === 'exchange' ? (
          <View className="border-border gap-1 border-b px-4 py-3">
            {/* The spans are React Native's own Text, which inherits the line's colour and size;
                the themed Text would reset each span to the foreground colour. Words not yet
                final are fainter: opacity has no effect on a nested span, a colour does. */}
            {bilingual && (
              <Text className="text-muted-foreground" style={source} allowFontScaling={false}>
                {leadTrimmed(item.source).map((r) => (
                  <Span key={r.key} className={cn(!r.final && 'text-muted-foreground/60')}>{r.text}</Span>
                ))}
              </Text>
            )}
            <Text className="font-medium" style={translation} allowFontScaling={false}>
              {leadTrimmed(item.translation).map((r) => (
                <Span key={r.key} className={cn(!r.final && 'text-muted-foreground')}>{r.text}</Span>
              ))}
            </Text>
          </View>
        ) : (
          <Text className="text-destructive px-4 py-2" style={notice} allowFontScaling={false}>{item.message}</Text>
        )
      }
    />
  );
}
