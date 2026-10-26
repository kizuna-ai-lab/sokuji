import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SonioxSttStream } from '@shared/providers/soniox/sttStream';
import { sonioxHosts } from '@shared/lib/soniox/regions';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>{sonioxHosts('us').sttRt}</Text>
      <Text>{typeof SonioxSttStream}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
