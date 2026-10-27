import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Entry } from '@shared/lib/projection/types';

// Subtitle size per the setting: the translation is what is read, the source
// sits above it smaller and quieter (design: direction C).
const SIZES = {
  small: { source: 13, translation: 18 },
  medium: { source: 15, translation: 22 },
  large: { source: 17, translation: 28 },
} as const;

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
      style={styles.list}
      data={entries}
      inverted
      keyExtractor={(e) => e.id}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={5}
      removeClippedSubviews
      renderItem={({ item }) =>
        item.kind === 'exchange' ? (
          <View style={styles.row}>
            {bilingual && (
              <Text style={[styles.source, { fontSize: size.source }]}>
                {item.source.map((r) => (
                  <Text key={r.key} style={r.final ? undefined : styles.pending}>{r.text}</Text>
                ))}
              </Text>
            )}
            <Text style={[styles.translation, { fontSize: size.translation }]}>
              {item.translation.map((r) => (
                <Text key={r.key} style={r.final ? undefined : styles.pending}>{r.text}</Text>
              ))}
            </Text>
          </View>
        ) : (
          <Text style={styles.notice}>{item.message}</Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, width: '100%' },
  row: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', gap: 4 },
  source: { color: '#777' },
  translation: { color: '#111', fontWeight: '500' },
  pending: { color: '#999' },
  notice: { paddingHorizontal: 16, paddingVertical: 6, color: '#b00', fontSize: 13 },
});
