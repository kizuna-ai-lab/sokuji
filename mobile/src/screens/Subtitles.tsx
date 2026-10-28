import { FlatList, Text as Span, View } from 'react-native';
import type { Entry } from '@shared/lib/projection/types';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { leadTrimmed } from '@/lib/spans';

// Subtitle size per the setting: the translation is what is read, the source
// sits above it smaller and quieter (design: direction C).
const SIZES = {
  small: { source: 13, translation: 18 },
  medium: { source: 15, translation: 22 },
  large: { source: 17, translation: 28 },
} as const;

// How far each line follows the system's text size. The translation grows the
// most; the source and the notices less, so at the largest sizes they do not
// crowd the current translation off the screen (design scope: Subtitles).
const SOURCE_MAX_SCALE = 1.5;
const TRANSLATION_MAX_SCALE = 2.5;

// Scrolled back further than this, a new line does not pull the list down to it.
const FOLLOW_WITHIN = 48;

// A size set inline replaces the class's font size but not its 24-unit line
// height, which a 28-unit line overlaps: each line carries its own.
const lineHeight = (fontSize: number) => Math.round(fontSize * 1.35);

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
              <Text className="text-muted-foreground" style={{ fontSize: size.source, lineHeight: lineHeight(size.source) }} maxFontSizeMultiplier={SOURCE_MAX_SCALE}>
                {leadTrimmed(item.source).map((r) => (
                  <Span key={r.key} className={cn(!r.final && 'text-muted-foreground/60')}>{r.text}</Span>
                ))}
              </Text>
            )}
            <Text className="font-medium" style={{ fontSize: size.translation, lineHeight: lineHeight(size.translation) }} maxFontSizeMultiplier={TRANSLATION_MAX_SCALE}>
              {leadTrimmed(item.translation).map((r) => (
                <Span key={r.key} className={cn(!r.final && 'text-muted-foreground')}>{r.text}</Span>
              ))}
            </Text>
          </View>
        ) : (
          <Text className="text-destructive px-4 py-2 text-sm" maxFontSizeMultiplier={SOURCE_MAX_SCALE}>{item.message}</Text>
        )
      }
    />
  );
}
