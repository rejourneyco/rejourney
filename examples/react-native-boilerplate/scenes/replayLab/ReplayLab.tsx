import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Mask, Rejourney } from 'rejourney';
import { colors, fonts } from '@/theme';

const NESTED_VIDEO_SOURCE = require('@/assets/media/brew-nested-video-demo.mp4');
const NESTED_VIDEO_POSTER = require('@/assets/media/brew-video-poster.png');

export default function ReplayLab() {
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [displayName, setDisplayName] = useState('Alex Morgan');
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [privateNote, setPrivateNote] = useState('Quarterly plan upgrade notes');

  const videoPlayer = useVideoPlayer(NESTED_VIDEO_SOURCE, player => {
    player.loop = true;
    player.muted = true;
    player.volume = 0;
  });

  const toggleVideo = useCallback(() => {
    const nextPlaying = !isVideoPlaying;
    setShowPoster(false);
    if (nextPlaying) {
      videoPlayer.play();
    } else {
      videoPlayer.pause();
    }
    setIsVideoPlaying(nextPlaying);
    Rejourney.logEvent('boilerplate_replay_lab_nested_video_toggled', {
      playing: nextPlaying,
    });
  }, [isVideoPlaying, videoPlayer]);

  const resetVideo = useCallback(() => {
    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    setIsVideoPlaying(false);
    setShowPoster(true);
    Rejourney.logEvent('boilerplate_replay_lab_nested_video_reset');
  }, [videoPlayer]);

  const nestedVideoTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) toggleVideo();
        }),
    [toggleVideo],
  );

  const nestedVideoLongPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(450)
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) resetVideo();
        }),
    [resetVideo],
  );

  const nestedVideoGesture = useMemo(
    () => Gesture.Exclusive(nestedVideoLongPressGesture, nestedVideoTapGesture),
    [nestedVideoLongPressGesture, nestedVideoTapGesture],
  );

  const openPaywall = useCallback(() => {
    setPaywallVisible(true);
    Rejourney.logEvent('boilerplate_replay_lab_paywall_opened');
  }, []);

  const closePaywall = useCallback(() => {
    setPaywallVisible(false);
    Rejourney.logEvent('boilerplate_replay_lab_paywall_closed');
  }, []);

  const completePaywall = useCallback(() => {
    closePaywall();
    setTimeout(() => {
      Alert.alert('Plan Activated', 'Sandbox premium access is active.');
    }, 250);
  }, [closePaywall]);

  const fireManualEvent = useCallback(() => {
    Rejourney.logEvent('boilerplate_replay_lab_manual_event', {
      searchLength: searchText.length,
      privateNoteLength: privateNote.length,
    });
    Alert.alert('Event Logged', 'Replay Lab event sent.');
  }, [privateNote.length, searchText.length]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Replay Lab</Text>
            <TouchableOpacity style={styles.headerButton} onPress={fireManualEvent}>
              <Feather name="zap" size={17} color={colors.white} />
              <Text style={styles.headerButtonText}>Log Event</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBadge}>
                <Feather name="film" size={20} color={colors.darkPurple} />
              </View>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardTitle}>Nested Video Button</Text>
                <Text style={styles.cardSubtitle}>expo-video with expo-image poster</Text>
              </View>
            </View>

            <GestureDetector gesture={nestedVideoGesture}>
              <View collapsable={false} style={styles.videoOuterShell}>
                <View collapsable={false} style={styles.videoMiddleShell}>
                  <View collapsable={false} style={styles.videoInnerShell}>
                    <VideoView
                      player={videoPlayer}
                      style={styles.video}
                      nativeControls={false}
                      contentFit="cover"
                      allowsFullscreen={false}
                      allowsPictureInPicture={false}
                      pointerEvents="none"
                    />
                    {showPoster && (
                      <ExpoImage
                        source={NESTED_VIDEO_POSTER}
                        style={styles.videoPoster}
                        contentFit="cover"
                        transition={160}
                        pointerEvents="none"
                      />
                    )}
                    <View style={styles.videoScrim} pointerEvents="none" />
                    <View style={styles.videoButtonOverlay} pointerEvents="none">
                      <Feather name={isVideoPlaying ? 'pause' : 'play'} size={18} color={colors.white} />
                      <Text style={styles.videoButtonText}>
                        {isVideoPlaying ? 'Pause Video' : 'Play Video'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </GestureDetector>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBadge}>
                <Feather name="image" size={20} color={colors.darkPurple} />
              </View>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardTitle}>Image and Video Masking</Text>
                <Text style={styles.cardSubtitle}>Shared poster asset and live player</Text>
              </View>
            </View>
            <View style={styles.mediaGrid}>
              <ExpoImage source={NESTED_VIDEO_POSTER} style={styles.mediaTile} contentFit="cover" />
              <View style={styles.mediaTile}>
                <VideoView
                  player={videoPlayer}
                  style={styles.video}
                  nativeControls={false}
                  contentFit="cover"
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                  pointerEvents="none"
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBadge}>
                <Feather name="type" size={20} color={colors.darkPurple} />
              </View>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardTitle}>Text Inputs</Text>
                <Text style={styles.cardSubtitle}>Plain, secure, numeric, and multiline fields</Text>
              </View>
            </View>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search query"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
            <TextInput
              value={cardNumber}
              onChangeText={setCardNumber}
              placeholder="Card number"
              placeholderTextColor={colors.gray}
              keyboardType="number-pad"
              style={styles.input}
            />
            <TextInput
              defaultValue="sandbox-pass"
              placeholder="Secure value"
              placeholderTextColor={colors.gray}
              secureTextEntry
              style={styles.input}
            />
            <TextInput
              value={privateNote}
              onChangeText={setPrivateNote}
              placeholder="Private note"
              placeholderTextColor={colors.gray}
              multiline
              style={[styles.input, styles.multilineInput]}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBadge}>
                <Feather name="shield" size={20} color={colors.darkPurple} />
              </View>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardTitle}>Custom Mask</Text>
                <Text style={styles.cardSubtitle}>Explicit Mask component surface</Text>
              </View>
            </View>
            <Mask style={styles.maskBox}>
              <Text style={styles.maskTitle}>Signed in as user_abc123</Text>
              <Text style={styles.maskText}>Synthetic card: 4242 4242 4242 4242</Text>
              <Text style={styles.maskText}>Plan token: premium_test_9f41</Text>
            </Mask>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBadge}>
                <Feather name="lock" size={20} color={colors.darkPurple} />
              </View>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardTitle}>Paywall Buttons</Text>
                <Text style={styles.cardSubtitle}>Modal, CTA, close, and restore actions</Text>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={openPaywall}>
                <Feather name="star" size={18} color={colors.white} />
                <Text style={styles.primaryButtonText}>Show Paywall</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert('Restored', 'Sandbox restore complete.')}>
                <Feather name="refresh-cw" size={17} color={colors.darkPurple} />
                <Text style={styles.secondaryButtonText}>Restore</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Pressable
            style={styles.tapZone}
            onPress={() => Rejourney.logEvent('boilerplate_replay_lab_dead_tap_surface_pressed')}>
            <Text style={styles.tapZoneTitle}>Dead Tap Surface</Text>
            <Text style={styles.tapZoneText}>Blank area for replay tap classification</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={paywallVisible}
        transparent
        animationType="fade"
        onRequestClose={closePaywall}>
        <View style={styles.modalBackdrop}>
          <View style={styles.paywall}>
            <TouchableOpacity style={styles.closeButton} onPress={closePaywall}>
              <Feather name="x" size={22} color={colors.black} />
            </TouchableOpacity>
            <View style={styles.paywallIcon}>
              <Feather name="award" size={28} color={colors.white} />
            </View>
            <Text style={styles.paywallEyebrow}>Plan Preview</Text>
            <Text style={styles.paywallTitle}>Unlock Growth Lab</Text>
            <Text style={styles.paywallBody}>
              Test gated replay flows with a modal, nested controls, background media, and masked fields.
            </Text>
            <Mask style={styles.paywallMaskedLine}>
              <Text style={styles.paywallMaskedText}>Account: user_abc123</Text>
            </Mask>
            <View style={styles.planRow}>
              <Text style={styles.planName}>Monthly Sandbox</Text>
              <Text style={styles.planPrice}>$9.99</Text>
            </View>
            <TouchableOpacity style={styles.paywallCta} onPress={completePaywall}>
              <Feather name="check-circle" size={19} color={colors.white} />
              <Text style={styles.paywallCtaText}>Start Sandbox Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.paywallTextButton} onPress={closePaywall}>
              <Text style={styles.paywallTextButtonLabel}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.lightGrayPurple,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 28,
  },
  headerButton: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: colors.darkPurple,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  headerButtonText: {
    color: colors.white,
    fontFamily: fonts.openSan.bold,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E2F0',
    gap: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#EAE7F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleGroup: {
    flex: 1,
  },
  cardTitle: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 16,
  },
  cardSubtitle: {
    color: colors.gray,
    fontFamily: fonts.openSan.regular,
    fontSize: 12,
    marginTop: 2,
  },
  videoOuterShell: {
    padding: 10,
    borderRadius: 24,
    backgroundColor: '#ECE8F8',
    borderWidth: 1,
    borderColor: '#D6CFF0',
  },
  videoMiddleShell: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F8F6FF',
  },
  videoInnerShell: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPoster: {
    ...StyleSheet.absoluteFillObject,
  },
  videoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.16)',
  },
  videoButtonOverlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  videoButtonText: {
    color: colors.white,
    fontFamily: fonts.openSan.bold,
    fontSize: 14,
  },
  mediaGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  mediaTile: {
    flex: 1,
    height: 138,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DED9EE',
    backgroundColor: '#FAFAFD',
    color: colors.black,
    fontFamily: fonts.openSan.regular,
    fontSize: 15,
    paddingHorizontal: 14,
  },
  multilineInput: {
    minHeight: 92,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  maskBox: {
    minHeight: 104,
    borderRadius: 8,
    backgroundColor: '#F8F6FF',
    borderWidth: 1,
    borderColor: '#DED9EE',
    padding: 16,
    justifyContent: 'center',
    gap: 5,
  },
  maskTitle: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 16,
  },
  maskText: {
    color: colors.gray,
    fontFamily: fonts.openSan.regular,
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: colors.white,
    fontFamily: fonts.openSan.bold,
    fontSize: 14,
  },
  secondaryButton: {
    minWidth: 112,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#ECE8F8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: colors.darkPurple,
    fontFamily: fonts.openSan.bold,
    fontSize: 14,
  },
  tapZone: {
    minHeight: 140,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E2F0',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  tapZoneTitle: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 16,
  },
  tapZoneText: {
    color: colors.gray,
    fontFamily: fonts.openSan.regular,
    fontSize: 12,
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 18, 18, 0.58)',
    justifyContent: 'center',
    padding: 24,
  },
  paywall: {
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#DED9EE',
    padding: 22,
    gap: 14,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F1F7',
    zIndex: 2,
  },
  paywallIcon: {
    width: 54,
    height: 54,
    borderRadius: 8,
    backgroundColor: colors.darkPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paywallEyebrow: {
    color: colors.pink,
    fontFamily: fonts.openSan.bold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  paywallTitle: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 24,
  },
  paywallBody: {
    color: colors.gray,
    fontFamily: fonts.openSan.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  paywallMaskedLine: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#F8F6FF',
    borderWidth: 1,
    borderColor: '#DED9EE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  paywallMaskedText: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 13,
  },
  planRow: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: '#FAFAFD',
    borderWidth: 1,
    borderColor: '#E5E2F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  planName: {
    color: colors.black,
    fontFamily: fonts.openSan.bold,
    fontSize: 14,
  },
  planPrice: {
    color: colors.darkPurple,
    fontFamily: fonts.openSan.bold,
    fontSize: 16,
  },
  paywallCta: {
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: colors.darkPurple,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  paywallCtaText: {
    color: colors.white,
    fontFamily: fonts.openSan.bold,
    fontSize: 15,
  },
  paywallTextButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paywallTextButtonLabel: {
    color: colors.gray,
    fontFamily: fonts.openSan.bold,
    fontSize: 14,
  },
});
