/**
 * Stress screens for manual SDK testing (matrix cases S6 and S7).
 *
 * Maps, video and image masking already have scenes here (map, mapbox,
 * replayLab). What was missing were the two cases that strain the capture path
 * with no media API involved: a long scroll over many decoded images, and a
 * view tree deep and wide enough to exercise the hierarchy scanner's depth cap
 * and its 16ms budget.
 *
 * Images come from picsum.photos, which serves public-domain photography, and
 * each URL carries a distinct seed so the SDK's frame deduplication sees real
 * changes while scrolling rather than one repeated picture.
 */

import React, { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';

const IMAGE_COUNT = 60;
const DENSE_ROWS = 40;
const DENSE_COLUMNS = 6;
const DENSE_NESTING = 14;

const photo = (seed: number) =>
  `https://picsum.photos/seed/rejourney${seed}/400/300`;

function ImageScroll() {
  const data = useMemo(
    () => Array.from({ length: IMAGE_COUNT }, (_, i) => i),
    [],
  );

  return (
    <FlatList
      data={data}
      keyExtractor={i => String(i)}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <ExpoImage
            source={{ uri: photo(item + 10) }}
            style={styles.cardImage}
            contentFit="cover"
            transition={0}
          />
          <Text style={styles.cardCaption}>
            Item {item + 1} of {IMAGE_COUNT}
          </Text>
        </View>
      )}
    />
  );
}

/** Wraps content in `depth` nested Views so one cell adds many hierarchy levels. */
function nest(child: React.ReactNode, depth: number): React.ReactNode {
  let current = child;
  for (let i = 0; i < depth; i += 1) {
    current = <View style={styles.nested}>{current}</View>;
  }
  return current;
}

function DenseTree() {
  const rows = useMemo(
    () => Array.from({ length: DENSE_ROWS }, (_, i) => i),
    [],
  );
  const columns = useMemo(
    () => Array.from({ length: DENSE_COLUMNS }, (_, i) => i),
    [],
  );

  return (
    <ScrollView>
      {rows.map(row => (
        <View key={row} style={styles.denseRow}>
          {columns.map(col => (
            <View key={col} style={styles.denseCell}>
              {nest(
                <View
                  style={[
                    styles.denseBox,
                    {
                      backgroundColor: `hsl(${
                        ((row * DENSE_COLUMNS + col) % 20) * 18
                      }, 45%, 88%)`,
                    },
                  ]}
                >
                  <Text style={styles.denseLabel}>
                    {row}.{col}
                  </Text>
                </View>,
                DENSE_NESTING,
              )}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export default function Stress() {
  const [mode, setMode] = useState<'menu' | 'images' | 'dense'>('menu');

  if (mode === 'images') {
    return (
      <View style={styles.fill}>
        <Back onPress={() => setMode('menu')} label="S6 · Image scroll" />
        <ImageScroll />
      </View>
    );
  }

  if (mode === 'dense') {
    return (
      <View style={styles.fill}>
        <Back onPress={() => setMode('menu')} label="S7 · Dense tree" />
        <DenseTree />
      </View>
    );
  }

  return (
    <View style={styles.menu}>
      <Text style={styles.heading}>Capture stress</Text>
      <Text style={styles.sub}>
        Maps, video and masking live in the Map, Mapbox and Replay Lab tabs.
        These cover scroll depth and hierarchy depth.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setMode('images')}
        testID="stress-images"
      >
        <Text style={styles.buttonText}>S6 · Image scroll</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setMode('dense')}
        testID="stress-dense"
      >
        <Text style={styles.buttonText}>S7 · Dense view tree</Text>
      </TouchableOpacity>
    </View>
  );
}

function Back({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <TouchableOpacity style={styles.back} onPress={onPress}>
      <Text style={styles.backText}>‹ {label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menu: { flex: 1, padding: 20, gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  sub: { fontSize: 13, opacity: 0.7, marginBottom: 8 },
  button: {
    backgroundColor: '#5a4fcf',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600' },
  back: { padding: 12 },
  backText: { fontSize: 15, color: '#5a4fcf', fontWeight: '600' },
  card: { marginHorizontal: 12, marginVertical: 6 },
  cardImage: { width: '100%', height: 180, borderRadius: 10 },
  cardCaption: { fontSize: 12, opacity: 0.7, marginTop: 4 },
  nested: { padding: 0.5, borderWidth: 0.5, borderColor: 'rgba(90,79,207,0.05)' },
  denseRow: { flexDirection: 'row' },
  denseCell: { flex: 1 },
  denseBox: { height: 40, alignItems: 'center', justifyContent: 'center' },
  denseLabel: { fontSize: 9 },
});
