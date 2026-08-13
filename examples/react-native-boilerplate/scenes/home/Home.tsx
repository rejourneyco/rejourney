import { Alert, Modal, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import useColorScheme from '@/hooks/useColorScheme';
import Button from '@/components/elements/Button';
import { useRouter } from 'expo-router';
import { colors } from '@/theme';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lightGrayPurple,
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 32,
    marginBottom: 12,
    color: colors.blackGray,
  },
  buttonTitle: {
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
  },
  secondaryButtonTitle: {
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.lightPurple,
    height: 44,
    width: '50%',
  },
  testButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.darkPurple,
    minHeight: 44,
    width: '72%',
    marginTop: 10,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 24,
    backgroundColor: colors.white,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    color: colors.blackGray,
  },
  modalBody: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
    color: colors.gray,
  },
  modalButton: {
    width: '100%',
    backgroundColor: colors.lightPurple,
  },
});

export default function Home() {
  const router = useRouter();
  const { isDark } = useColorScheme();
  const [isModalVisible, setModalVisible] = useState(false);

  const showNativeAlert = () => {
    Alert.alert('Native Alert', 'This Android alert should appear as an app-owned native dialog.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => undefined },
    ]);
  };

  const showShareSheet = async () => {
    try {
      await Share.share({
        title: 'Rejourney native sheet test',
        message: 'Testing Android native sheet capture from the Expo boilerplate app.',
      });
    } catch {
      Alert.alert('Share unavailable', 'The native share sheet could not be opened.');
    }
  };

  return (
    <View style={[styles.root, isDark && { backgroundColor: colors.blackGray }]}>
      <Text style={[styles.title, isDark && { color: colors.gray }]}>Home</Text>
      <Button
        title="Go to Details"
        titleStyle={[styles.buttonTitle, isDark && { color: colors.blackGray }]}
        style={styles.button}
        onPress={() =>
          router.push({ pathname: '(main)/(tabs)/home/details', params: { from: 'Home' } })
        }
      />
      <Text style={[styles.sectionTitle, isDark && { color: colors.gray }]}>
        Android native sheet tests
      </Text>
      <Button
        title="Show Alert Dialog"
        titleStyle={styles.secondaryButtonTitle}
        style={styles.testButton}
        onPress={showNativeAlert}
      />
      <Button
        title="Show Modal Dialog"
        titleStyle={styles.secondaryButtonTitle}
        style={styles.testButton}
        onPress={() => setModalVisible(true)}
      />
      <Button
        title={Platform.OS === 'android' ? 'Open Android Share Sheet' : 'Open Share Sheet'}
        titleStyle={styles.secondaryButtonTitle}
        style={styles.testButton}
        onPress={showShareSheet}
      />
      <Modal
        visible={isModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Native Modal</Text>
            <Text style={styles.modalBody}>
              This React Native modal is backed by a native Android dialog window.
            </Text>
            <Button
              title="Close"
              titleStyle={styles.buttonTitle}
              style={[styles.button, styles.modalButton]}
              onPress={() => setModalVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
